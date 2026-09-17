import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { apply } from '../../dist/index.js';
import JSZip from 'jszip';

const fixtureZip = await JSZip.loadAsync(
  await readFile('.cache/synthetic.pptx'),
);
const fixtureImage = Object.keys(fixtureZip.files).find((name) =>
  /^ppt\/media\/.*\.png$/.test(name),
);
if (!fixtureImage) throw new Error('Synthetic PNG missing');
const imageBytes = await fixtureZip.file(fixtureImage).async('uint8array');
const imageRef = {
  attachmentId: 'synthetic-image',
  name: 'synthetic.png',
  mediaType: 'image/png',
  bytes: imageBytes.length,
  width: 20,
  height: 20,
};

// Test-only host: exercises the built plugin through its public registration contract.
await build({
  entryPoints: ['tests/e2e/panel.tsx'],
  outfile: '.cache/test-panel.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
});
await build({
  entryPoints: ['tests/e2e/public-viewer.mjs'],
  outfile: '.cache/public-viewer.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
const tools = new Map();
const routes = [];
const disposers = [];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (path === '/test/public-viewer') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<link rel="stylesheet" href="/test/public-viewer.css"><div id="root" style="height:100vh"></div><script type="module" src="/test/public-viewer.js"></script>',
    );
    return;
  }
  if (path === '/test/public-viewer.js' || path === '/test/public-viewer.css') {
    res.setHeader(
      'Content-Type',
      path.endsWith('.js') ? 'text/javascript' : 'text/css',
    );
    res.end(
      await readFile(
        `.cache/public-viewer.${path.endsWith('.js') ? 'js' : 'css'}`,
      ),
    );
    return;
  }
  if (path === '/test/command' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const {
        name,
        args = {},
        sessionId = 'synthetic-session',
      } = JSON.parse(body);
      const definition = tools.get(name);
      if (!definition) throw new Error('Unknown test tool');
      const value = await definition.execute(args, {
        agent: {
          id: sessionId,
          session: {
            snapshotEvents: () =>
              sessionId === 'capability-image'
                ? [
                    {
                      type: 'user/message',
                      seq: 1,
                      data: {
                        content: [{ type: 'image', attachment: imageRef }],
                      },
                    },
                  ]
                : [],
          },
        },
        signal: AbortSignal.timeout(10_000),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  if (path === '/test/panel') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<div id="root"></div><script type="module" src="/test/panel.js"></script>',
    );
    return;
  }
  if (path === '/test/panel.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(await readFile('.cache/test-panel.js'));
    return;
  }
  if (path === '/test/fixture') {
    res.end(
      await readFile(new URL('../../.cache/synthetic.pptx', import.meta.url)),
    );
    return;
  }
  const route = routes.find(
    (entry) => path === entry.path || path.startsWith(`${entry.path}/`),
  );
  if (route) return route.handler(req, res);
  res.writeHead(404);
  res.end();
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(3093, '127.0.0.1', resolve);
});
apply({
  webServer: {
    host: '127.0.0.1',
    port: 3093,
    register(route) {
      routes.push(route);
      return () => {
        routes.splice(routes.indexOf(route), 1);
      };
    },
  },
  connection: { requestRejection: () => undefined },
  attachments: {
    readImage: async (ref) => {
      if (ref.attachmentId !== imageRef.attachmentId)
        throw new Error('Unknown synthetic image');
      return { ref: imageRef, data: imageBytes };
    },
  },
  tools: {
    register(tool) {
      tools.set(tool.name, tool);
    },
  },
  effect(start) {
    disposers.push(start());
  },
});
process.on('SIGTERM', () => {
  for (const dispose of disposers.reverse()) dispose();
  server.close();
});
