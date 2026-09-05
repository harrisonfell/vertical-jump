/**
 * Picking the export file.
 *
 * Native uses the document picker, which is also what the OVR Connect share
 * sheet hands a file to; the web build takes a file input. A CSV comes back as
 * text and a workbook as bytes, and that is the only difference the rest of
 * the importer sees: both are read into the same header-keyed rows one step
 * later, so neither format gets a second code path.
 */
import { Platform } from 'react-native';

export type PickedFile =
  | { readonly kind: 'text'; readonly name: string; readonly text: string }
  | { readonly kind: 'workbook'; readonly name: string; readonly bytes: Uint8Array }
  | { readonly kind: 'cancelled' };

const SHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LEGACY_SHEET_MIME = 'application/vnd.ms-excel';

const PICKABLE_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'text/plain',
  LEGACY_SHEET_MIME,
  SHEET_MIME,
];

/** True for a name or mime type that has to be read as a workbook. */
export function isSpreadsheet(name: string, mimeType?: string | null): boolean {
  if (/\.xlsx?$/i.test(name)) return true;
  return mimeType === SHEET_MIME || mimeType === LEGACY_SHEET_MIME;
}

async function pickOnWeb(): Promise<PickedFile> {
  if (typeof document === 'undefined') return { kind: 'cancelled' };

  return new Promise<PickedFile>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.xls,text/csv';
    input.style.position = 'fixed';
    input.style.opacity = '0';

    let settled = false;
    const finish = (result: PickedFile): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(result);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file === undefined) {
        finish({ kind: 'cancelled' });
        return;
      }
      const cancel = (): void => {
        finish({ kind: 'cancelled' });
      };
      if (isSpreadsheet(file.name, file.type)) {
        file
          .arrayBuffer()
          .then((buffer) => {
            finish({ kind: 'workbook', name: file.name, bytes: new Uint8Array(buffer) });
          })
          .catch(cancel);
        return;
      }
      file
        .text()
        .then((text) => {
          finish({ kind: 'text', name: file.name, text });
        })
        .catch(cancel);
    });
    // A cancelled picker fires `cancel` in modern browsers and nothing at all
    // in older ones, so the promise also settles when focus comes back.
    input.addEventListener('cancel', () => {
      finish({ kind: 'cancelled' });
    });

    document.body.appendChild(input);
    input.click();
  });
}

async function pickOnNative(): Promise<PickedFile> {
  const DocumentPicker = await import('expo-document-picker');
  const result = await DocumentPicker.getDocumentAsync({
    type: PICKABLE_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return { kind: 'cancelled' };

  const asset = result.assets[0];
  if (asset === undefined) return { kind: 'cancelled' };

  const { File } = await import('expo-file-system');
  const handle = new File(asset.uri);
  if (isSpreadsheet(asset.name, asset.mimeType)) {
    const buffer = await handle.arrayBuffer();
    return { kind: 'workbook', name: asset.name, bytes: new Uint8Array(buffer) };
  }
  return { kind: 'text', name: asset.name, text: await handle.text() };
}

/** Open the picker and read the chosen file. Never throws for a cancel. */
export async function pickImportFile(): Promise<PickedFile> {
  return Platform.OS === 'web' ? pickOnWeb() : pickOnNative();
}
