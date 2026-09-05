/**
 * Handing a built file to the platform.
 *
 * Web writes a Blob and clicks an anchor; native writes into the cache
 * directory and opens the share sheet. Both are behind one call so the screen
 * never has a platform branch in it, and both are lazy: the native modules are
 * imported inside the function so the web bundle's static render pass never
 * touches them.
 */
import { Platform } from 'react-native';
import type { ExportFile } from './exportData';

export type SaveOutcome = 'saved' | 'shared' | 'unavailable';

export class SaveFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFailedError';
  }
}

/** "Couldn't save. Check your connection." shape: cause, then fix. */
export const SAVE_FAILED_COPY = 'Could not write the file. Free some space and try again.';

async function saveOnWeb(file: ExportFile): Promise<SaveOutcome> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return 'unavailable';
  const blob = new Blob([file.text], { type: `${file.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
  return 'saved';
}

async function saveOnNative(file: ExportFile): Promise<SaveOutcome> {
  const { File, Paths } = await import('expo-file-system');
  const Sharing = await import('expo-sharing');

  const target = new File(Paths.cache, file.name);
  try {
    target.create({ overwrite: true });
  } catch {
    // An existing file is fine; write() replaces its contents.
  }
  target.write(file.text);

  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(target.uri, {
    mimeType: file.mime,
    UTI: file.mime === 'application/json' ? 'public.json' : 'public.comma-separated-values-text',
    dialogTitle: file.label,
  });
  return 'shared';
}

/** Save one export file. Throws `SaveFailedError` with copy the screen shows. */
export async function saveFile(file: ExportFile): Promise<SaveOutcome> {
  try {
    return Platform.OS === 'web' ? await saveOnWeb(file) : await saveOnNative(file);
  } catch (caught) {
    throw new SaveFailedError(caught instanceof Error ? caught.message : SAVE_FAILED_COPY);
  }
}
