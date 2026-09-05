import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { AppHeader } from '@/app';
import {
  useCommitImport,
  useImportExistingData,
  useImports,
  type ImportJumpGroup,
  type ImportVbtSet,
} from '@/data';
import { Button, Disclosure, EmptyState, Notice, Screen, Table, Text, space } from '@/ui';
import { RowDivider, SettingRow, SettingSection } from '../settings';
import { buildPreview, readFile, OVR_CONNECT, type ImportPreview } from './preview';
import { pickImportFile, XLSX_UNSUPPORTED } from './pick';
import { batchLabel } from './hash';
import { toJumpGroups, toVbtSets } from './commit';
import { MappingStep } from './mappingStep';
import type { CanonicalField } from './headers';

/**
 * The import screen: pick, preview, confirm.
 *
 * Nothing is written until Confirm, and the preview is built from the same
 * pure functions the tests run, so what the counts say is exactly what the
 * commit does. A re-import of the same export is a no-op, announced rather
 * than silent, because the file is always full history and the athlete has no
 * way to tell from the outside.
 */

export function ImportScreen() {
  const existing = useImportExistingData();
  const commit = useCommitImport();
  const history = useImports(5);

  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [manual, setManual] = useState<Partial<Record<CanonicalField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const file = useMemo(
    () => (text === null || fileName === null ? null : readFile(fileName, text, manual)),
    [fileName, text, manual],
  );

  const alreadyImported = useMemo(() => {
    if (file === null) return false;
    return (history.data ?? []).some(
      (batch) => batch.fileHash === file.hash && batch.status === 'committed',
    );
  }, [file, history.data]);

  const preview = useMemo<ImportPreview | null>(() => {
    if (file === null) return null;
    return buildPreview(
      file,
      { jumps: existing.data?.jumps ?? [], velocitySets: existing.data?.velocitySets ?? [] },
      alreadyImported,
    );
  }, [file, existing.data, alreadyImported]);

  const onPick = useCallback(async () => {
    setPicking(true);
    setError(null);
    setDone(null);
    try {
      const picked = await pickImportFile();
      if (picked.kind === 'cancelled') return;
      if (picked.kind === 'unsupported') {
        setError(`${picked.name} is a spreadsheet. ${XLSX_UNSUPPORTED}.`);
        return;
      }
      setManual({});
      setFileName(picked.name);
      setText(picked.text);
    } catch {
      setError('Could not read that file. Pick it again.');
    } finally {
      setPicking(false);
    }
  }, []);

  const onConfirm = useCallback(() => {
    if (preview === null || file === null) return;
    const jumps: readonly ImportJumpGroup[] = toJumpGroups(preview.newJumps);
    const sets: readonly ImportVbtSet[] = toVbtSets(preview.newSets);

    commit.mutate(
      {
        batch: {
          fileHash: file.hash,
          fileName: file.fileName,
          type: 'ovr_connect',
          rowCount: file.rowCount,
          mapping: file.mapping.mapping,
          counts: {
            newJumps: preview.newJumps.length,
            newSets: preview.newSets.length,
            matched: preview.matchedJumps.length + preview.matchedSets.length,
          },
        },
        jumps,
        sets,
      },
      {
        onSuccess: (result) => {
          setDone(
            result.wrote
              ? `Imported. ${result.testsWritten} ${result.testsWritten === 1 ? 'test' : 'tests'} and ${result.setsWritten} ${result.setsWritten === 1 ? 'set' : 'sets'} added.`
              : 'That export was already imported. Nothing changed.',
          );
          setFileName(null);
          setText(null);
        },
      },
    );
  }, [commit, file, preview]);

  return (
    <Screen
      header={<AppHeader title="Import" showSettings={false} />}
      gap={space.xxl}
      testID="import-screen"
    >
      {preview === null ? (
        <EmptyState
          body={`${OVR_CONNECT}s hold your full jump and velocity history. Pick the file and you will see exactly what is new before anything is written.`}
          actionLabel={picking ? 'Opening' : 'Choose export file'}
          onAction={() => void onPick()}
        />
      ) : null}

      {error === null ? null : <Notice text={error} live />}
      {done === null ? null : <Notice text={done} live />}
      {commit.isError ? <Notice text="Could not write the import. Try Confirm again." live /> : null}

      {preview === null ? null : (
        <SettingSection title="Preview" testID="import-preview">
          <SettingRow label={preview.file.fileName} caption={preview.line} testID="import-line" />
          <RowDivider />
          {preview.alreadyImported ? (
            <Notice text="This export has already been imported. Confirming changes nothing." />
          ) : null}
          {preview.unrecognized === null ? null : <Notice text={preview.unrecognized} />}

          {preview.needsMapping ? (
            <MappingStep
              headers={preview.file.header}
              mapping={manual}
              onChange={setManual}
            />
          ) : null}

          <SettingRow
            label="New jumps"
            value={`${preview.newJumps.length}`}
            numeric
            caption={
              preview.duplicateJumps === 0
                ? undefined
                : `${preview.duplicateJumps} already imported`
            }
          />
          <RowDivider />
          <SettingRow label="New velocity sets" value={`${preview.newSets.length}`} numeric />
          <RowDivider />
          <SettingRow
            label="Matched to typed entries"
            value={`${preview.matchedJumps.length + preview.matchedSets.length}`}
            numeric
            caption="Kept as one entry. Contact time and velocity fill in behind them."
          />
          {preview.file.skipped.length === 0 ? null : (
            <>
              <RowDivider />
              <Disclosure
                title={`${preview.file.skipped.length} rows skipped`}
                summary="Rows the file could not be read from."
              >
                <Table
                  columns={[
                    { key: 'row', header: 'Row', numeric: true, render: (r) => `${r.row}` },
                    { key: 'reason', header: 'Reason', render: (r) => r.reason },
                  ]}
                  rows={preview.file.skipped.slice(0, 50)}
                  rowKey={(row) => `${row.row}`}
                />
              </Disclosure>
            </>
          )}

          <View style={{ flexDirection: 'row', gap: space.sm, paddingTop: space.lg }}>
            <Button
              label="Confirm import"
              variant="primary"
              disabled={preview.needsMapping || commit.isPending}
              loading={commit.isPending}
              onPress={onConfirm}
              testID="import-confirm"
            />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                setFileName(null);
                setText(null);
                setManual({});
              }}
              testID="import-cancel"
            />
          </View>
        </SettingSection>
      )}

      {(history.data ?? []).length === 0 ? null : (
        <SettingSection title="Earlier imports" testID="import-history">
          {(history.data ?? []).map((batch, index) => (
            <View key={batch.id}>
              {index === 0 ? null : <RowDivider />}
              <SettingRow
                label={batch.fileName ?? batchLabel(batch.type, batch.fileHash)}
                value={batch.status}
                caption={`${batch.rowCount} rows · ${batch.createdAt.slice(0, 10)}`}
                numeric
              />
            </View>
          ))}
        </SettingSection>
      )}

      <Text variant="caption" color="ink3">
        Every imported row is marked as imported, so a typed number is never overwritten.
      </Text>
    </Screen>
  );
}
