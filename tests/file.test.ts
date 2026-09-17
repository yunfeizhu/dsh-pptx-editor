// @vitest-environment jsdom
import JSZip from 'jszip';
import { afterEach, expect, it, vi } from 'vitest';
import { openDocument, openAttachment } from '../src/editor/file.js';
import { MAX_FILE_BYTES } from '../src/protocol.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fileHandle() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('ppt/presentation.xml', '<presentation/>');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const writable = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
  };
  const handle = {
    name: 'synthetic.pptx',
    getFile: vi.fn(() =>
      Promise.resolve({
        size: bytes.length,
        arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
      }),
    ),
    createWritable: vi.fn(() => Promise.resolve(writable)),
  };
  vi.stubGlobal(
    'showOpenFilePicker',
    vi.fn(() => Promise.resolve([handle])),
  );
  return { handle, bytes, writable };
}

it('keeps writes bound to the selected file and closes the writable before resolving', async () => {
  const { bytes, writable } = await fileHandle();
  const opened = await openDocument();
  expect(opened.bytes).toEqual(bytes);
  expect(opened.file.name).toBe('synthetic.pptx');
  await opened.file.write(new Uint8Array([1, 2]));
  expect(writable.write).toHaveBeenCalledWith(new Uint8Array([1, 2]).buffer);
  expect(writable.close).toHaveBeenCalledOnce();
});

it('aborts a failed write and propagates permission failures', async () => {
  const { writable, handle } = await fileHandle();
  const opened = await openDocument();
  writable.write.mockRejectedValueOnce(new Error('Disk full'));
  await expect(opened.file.write(new Uint8Array([1]))).rejects.toThrow(
    'Disk full',
  );
  expect(writable.abort).toHaveBeenCalledOnce();
  writable.close.mockRejectedValueOnce(new Error('Close failed'));
  writable.abort.mockRejectedValueOnce(new Error('Already closed'));
  await expect(opened.file.write(new Uint8Array([1]))).rejects.toThrow(
    'Close failed',
  );
  handle.createWritable.mockRejectedValueOnce(new Error('Permission denied'));
  await expect(opened.file.write(new Uint8Array([1]))).rejects.toThrow(
    'Permission',
  );
});

it('rejects oversized, invalid, non-PPTX and cancelled file selections', async () => {
  const { handle } = await fileHandle();
  handle.getFile.mockResolvedValueOnce({
    size: MAX_FILE_BYTES + 1,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });
  await expect(openDocument()).rejects.toThrow('50 MiB');
  handle.getFile.mockResolvedValueOnce({
    size: 1,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
  });
  await expect(openDocument()).rejects.toThrow();
  const bytes = await new JSZip().generateAsync({ type: 'arraybuffer' });
  handle.getFile.mockResolvedValueOnce({
    size: bytes.byteLength,
    arrayBuffer: () => Promise.resolve(bytes),
  });
  await expect(openDocument()).rejects.toThrow('Not a supported');
  vi.stubGlobal(
    'showOpenFilePicker',
    vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')),
  );
  await expect(openDocument()).rejects.toThrow('Cancelled');
});

it('reports browsers without writable file handles', async () => {
  delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  await expect(openDocument()).rejects.toThrow('Chrome or Edge');
});

it('keeps an upload immutable, selects a destination once, and reuses only that handle', async () => {
  const { bytes, handle, writable } = await fileHandle();
  const opened = await openAttachment('upload.pptx', bytes);
  expect(opened.file.needsDestination).toBe(true);
  expect(opened.file.name).toBe('upload.pptx');
  expect(await opened.file.read()).toEqual(bytes);
  await expect(opened.file.write(bytes)).rejects.toThrow('Choose');
  const select = vi.fn().mockResolvedValue(handle);
  vi.stubGlobal('showSaveFilePicker', select);
  expect(await opened.file.prepareWrite?.()).toEqual(bytes);
  expect(opened.file.needsDestination).toBe(false);
  expect(opened.file.name).toBe('synthetic.pptx');
  expect(await opened.file.prepareWrite?.()).toBeUndefined();
  await opened.file.write(new Uint8Array([5]));
  expect(select).toHaveBeenCalledOnce();
  expect(writable.write).toHaveBeenCalledWith(new Uint8Array([5]).buffer);
  await opened.file.read();
  expect(handle.getFile).toHaveBeenCalledTimes(2);
});

it('preserves the upload after picker cancellation, permission failure, or unsupported save APIs', async () => {
  const { bytes } = await fileHandle();
  await expect(
    openAttachment('huge.pptx', new Uint8Array(MAX_FILE_BYTES + 1)),
  ).rejects.toThrow('50 MiB');
  const opened = await openAttachment('upload.pptx', bytes);
  delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  await expect(opened.file.prepareWrite?.()).rejects.toThrow('Chrome');
  vi.stubGlobal(
    'showSaveFilePicker',
    vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')),
  );
  await expect(opened.file.prepareWrite?.()).rejects.toThrow('Cancelled');
  expect(opened.file.needsDestination).toBe(true);
  expect(await opened.file.read()).toEqual(bytes);
});
