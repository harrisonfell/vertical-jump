/**
 * Picking the export file.
 *
 * Native uses the document picker, which is also what the OVR Connect share
 * sheet hands a file to; the web build takes a file input. Both return the
 * file's text, because everything downstream of here is pure.
 *
 * XLSX is recognised and refused rather than half-read: no spreadsheet parser
 * ships in this build, and guessing at a zipped XML container would produce
 * numbers the athlete cannot check.
 */
import { Platform } from 'react-native';

/** The one sentence an XLSX file gets. */
export const XLSX_UNSUPPORTED = 'Export as CSV from OVR Connect for now';

export type PickedFile =
  | { readonly kind: 'file'; readonly name: string; readonly text: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unsupported'; readonly name: string; readonly message: string };

const CSV_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/** True for a name or mime type this build cannot read. */
export function isSpreadsheet(name: string, mimeType?: string | null): boolean {
  if (/\.xlsx?$/i.test(name)) return true;
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  );
}

function unsupported(name: string): PickedFile {
  return { kind: 'unsupported', name, message: XLSX_UNSUPPORTED };
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
      if (isSpreadsheet(file.name, file.type)) {
        finish(unsupported(file.name));
        return;
      }
      file
        .text()
        .then((text) => {
          finish({ kind: 'file', name: file.name, text });
        })
        .catch(() => {
          finish({ kind: 'cancelled' });
        });
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
    type: CSV_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return { kind: 'cancelled' };

  const asset = result.assets[0];
  if (asset === undefined) return { kind: 'cancelled' };
  if (isSpreadsheet(asset.name, asset.mimeType)) return unsupported(asset.name);

  const { File } = await import('expo-file-system');
  const text = await new File(asset.uri).text();
  return { kind: 'file', name: asset.name, text };
}

/** Open the picker and read the chosen file. Never throws for a cancel. */
export async function pickImportFile(): Promise<PickedFile> {
  return Platform.OS === 'web' ? pickOnWeb() : pickOnNative();
}
