import JSZip from 'jszip';
import type { DocumentFile } from '../document-session.js';
import { MAX_FILE_BYTES } from '../protocol.js';

export interface OpenedDocument {
  file: DocumentFile;
  bytes: Uint8Array;
}
const types: FilePickerAcceptType[] = [
  {
    description: 'PowerPoint',
    accept: {
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        ['.pptx'],
    },
  },
];

function localFile(handle: FileSystemFileHandle): DocumentFile {
  return {
    name: handle.name,
    read: async () => {
      const data = await handle.getFile();
      if (data.size > MAX_FILE_BYTES)
        throw new Error('PPTX exceeds the 50 MiB limit');
      return new Uint8Array(await data.arrayBuffer());
    },
    write: async (bytes) => {
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes.slice().buffer);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
    },
  };
}

async function validate(bytes: Uint8Array): Promise<void> {
  if (bytes.length > MAX_FILE_BYTES)
    throw new Error('PPTX exceeds the 50 MiB limit');
  const archive = await JSZip.loadAsync(bytes);
  if (
    !archive.file('ppt/presentation.xml') ||
    !archive.file('[Content_Types].xml')
  )
    throw new Error('Not a supported PPTX file');
}

export async function openDocument(): Promise<OpenedDocument> {
  if (!('showOpenFilePicker' in window))
    throw new Error('Use Chrome or Edge to open a local file');
  const [handle] = await window.showOpenFilePicker({ multiple: false, types });
  const file = localFile(handle);
  const bytes = await file.read();
  await validate(bytes);
  return { file, bytes };
}

/** Uploaded attachments are immutable; only a separately selected destination is writable. */
export async function openAttachment(
  name: string,
  bytes: Uint8Array,
): Promise<OpenedDocument> {
  await validate(bytes);
  const original = bytes.slice();
  let destination: DocumentFile | undefined;
  const file: DocumentFile = {
    get name() {
      return destination?.name ?? name;
    },
    get needsDestination() {
      return !destination;
    },
    prepareWrite: async () => {
      if (destination) return undefined;
      if (!('showSaveFilePicker' in window))
        throw new Error('Use Chrome or Edge to choose a save location');
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types,
      });
      const selected = localFile(handle);
      const baseline = await selected.read();
      destination = selected;
      return baseline;
    },
    read: () =>
      destination ? destination.read() : Promise.resolve(original.slice()),
    write: async (content) => {
      if (!destination) throw new Error('Choose a save location first');
      await destination.write(content);
    },
  };
  return { file, bytes: original };
}
