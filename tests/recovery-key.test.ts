import { expect, it } from 'vitest';
import { recoveryKey } from '../src/editor/recovery-key.js';

it('recovers the same source across reloads without mixing conversations, occurrences or bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const key = await recoveryKey('chat-a', 'attachment:1:a', 'test.pptx', bytes);
  expect(
    await recoveryKey('chat-a', 'attachment:1:a', 'test.pptx', bytes),
  ).toBe(key);
  for (const [session, source, name, content] of [
    ['chat-b', 'attachment:1:a', 'test.pptx', bytes],
    ['chat-a', 'attachment:2:a', 'test.pptx', bytes],
    ['chat-a', 'local', 'test.pptx', bytes],
    ['chat-a', 'attachment:1:a', 'other.pptx', bytes],
    ['chat-a', 'attachment:1:a', 'test.pptx', new Uint8Array([1, 2, 4])],
  ] as const) {
    expect(await recoveryKey(session, source, name, content)).not.toBe(key);
  }
  expect(key).toMatch(/^dsh-pptx\/[a-f0-9]{64}\/test\.pptx$/);
  expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
});
