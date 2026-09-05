import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { SetPrescription } from '@vert/engine';
import { kgToLb, lbToKg } from '@vert/engine/units';
import type { SetLog } from '@/data';
import { Button, ChipRow, Notice, Sheet, Stepper, Text, space, type ChipOption } from '@/ui';
import type { TodayExercise } from './model';

/**
 * Correcting one set.
 *
 * The pencil has its own column outside the row's hit area precisely so this
 * is never an accident, and the sheet opens on what was actually done rather
 * than on what was prescribed. Sets stay editable for a week after the session.
 */

const RPE_OPTIONS: readonly ChipOption<number>[] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map(
  (value) => ({ value, label: String(value) }),
);

export interface EditSetValue {
  readonly repsDone: number | null;
  readonly loadKg: number | null;
  readonly rpe: number | null;
}

export interface EditSetSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly exercise: TodayExercise | null;
  readonly set: SetPrescription | null;
  readonly log: SetLog | null;
  readonly onSave: (value: EditSetValue) => void;
  readonly onDelete: () => void;
  readonly saving?: boolean;
  readonly error?: string | null;
}

export function EditSetSheet({
  visible,
  onClose,
  exercise,
  set,
  log,
  onSave,
  onDelete,
  saving = false,
  error = null,
}: EditSetSheetProps) {
  const [reps, setReps] = useState(0);
  const [loadLb, setLoadLb] = useState(0);
  const [rpe, setRpe] = useState<number | null>(null);

  // Reopening on a different row must not carry the last row's numbers over.
  useEffect(() => {
    if (!visible || set === null) return;
    setReps(log?.repsDone ?? set.reps ?? 0);
    setLoadLb(
      log?.loadKg != null
        ? Math.round(kgToLb(log.loadKg))
        : set.loadKg === undefined
          ? 0
          : Math.round(kgToLb(set.loadKg)),
    );
    setRpe(log?.rpe ?? null);
  }, [log, set, visible]);

  if (exercise === null || set === null) return null;

  const loadable = set.loadKg !== undefined || (log?.loadKg ?? null) !== null || loadLb > 0;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Set ${set.setNumber}`}
      subtitle={`${exercise.name} · prescribed ${set.displayLoad}`}
      actions={
        <View style={{ gap: space.sm }}>
          <Button
            label="Save set"
            variant="primary"
            size={56}
            fullWidth
            loading={saving}
            disabled={saving}
            onPress={() =>
              onSave({
                repsDone: reps > 0 ? reps : null,
                loadKg: loadable && loadLb > 0 ? lbToKg(loadLb) : null,
                rpe,
              })
            }
          />
          {log === null ? null : (
            <Button label="Remove this set" variant="destructive" fullWidth onPress={onDelete} />
          )}
        </View>
      }
    >
      <View style={{ gap: space.xl }}>
        {set.reps === undefined ? null : (
          <Stepper
            label="Reps done"
            value={reps}
            step={1}
            min={0}
            max={100}
            format={(value) => String(Math.round(value))}
            editable
            onChange={(value) => setReps(Math.round(value))}
          />
        )}

        {loadable ? (
          <Stepper
            label="Load"
            value={loadLb}
            step={5}
            min={0}
            max={1000}
            format={(value) => String(Math.round(value))}
            suffix="lb"
            editable
            onChange={(value) => setLoadLb(Math.round(value))}
          />
        ) : null}

        <View style={{ gap: space.sm }}>
          <Text variant="label" color="ink2">
            Effort (RPE)
          </Text>
          <ChipRow
            options={RPE_OPTIONS}
            value={rpe}
            onChange={setRpe}
            splitAfter={5}
            groupLabel="Effort, RPE 6 to 10"
          />
        </View>

        {error === null ? null : <Notice text={error} live />}
      </View>
    </Sheet>
  );
}
