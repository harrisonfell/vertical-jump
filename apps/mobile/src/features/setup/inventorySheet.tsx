import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatInteger } from '@vert/engine';
import type { Inventory } from '@vert/engine';
import { Button, ButtonRow, Chip, Sheet, Stepper, Text, space } from '@/ui';
import { CheckRow, Question } from './parts';
import { DEFAULT_INVENTORY, weightRoomAccess } from './inventory';

/**
 * The equipment editor. Collected once, because R19 refuses to select any
 * exercise whose equipment is absent, and R45 and R46 gate the barbell
 * compounds on weight-room access, which is derived here and never asked.
 */

const BOX_HEIGHTS = [12, 18, 20, 24, 30, 36, 42];
const HURDLE_HEIGHTS = [6, 9, 12, 15, 18];

interface HeightChipsProps {
  readonly label: string;
  readonly detail: string;
  readonly options: readonly number[];
  readonly selected: readonly number[];
  readonly onToggle: (value: number) => void;
}

function HeightChips({ label, detail, options, selected, onToggle }: HeightChipsProps) {
  return (
    <Question label={label} detail={detail}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {options.map((option) => (
          <Chip
            key={option}
            label={`${formatInteger(option)} in`}
            role="checkbox"
            selected={selected.includes(option)}
            onPress={() => onToggle(option)}
          />
        ))}
      </View>
    </Question>
  );
}

/** Adds or removes the vest without leaving an undefined key behind. */
function withVest(inventory: Inventory, wanted: boolean): Inventory {
  if (wanted) return { ...inventory, vestLb: inventory.vestLb ?? 20 };
  const next: Inventory = { ...inventory };
  delete next.vestLb;
  return next;
}

export interface InventorySheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly value: Inventory;
  readonly onSave: (next: Inventory) => void;
}

export function InventorySheet({ visible, onClose, value, onSave }: InventorySheetProps) {
  const [draft, setDraft] = useState<Inventory>(value);

  // The sheet opens on what is stored, not on what was typed and abandoned
  // the last time it was open.
  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const patch = (next: Partial<Inventory>): void => {
    setDraft((current) => {
      const merged = { ...current, ...next };
      return { ...merged, weightRoomAccess: weightRoomAccess(merged) };
    });
  };

  const toggleHeight = (key: 'boxHeightsIn' | 'hurdleHeightsIn', height: number): void => {
    setDraft((current) => {
      const list = current[key];
      const next = list.includes(height)
        ? list.filter((entry) => entry !== height)
        : [...list, height].sort((a, b) => a - b);
      return { ...current, [key]: next };
    });
  };

  const dumbbells = draft.dumbbells;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Equipment"
      subtitle="What you actually have. Anything absent is never prescribed."
      testID="inventory-sheet"
      actions={
        <ButtonRow align="between">
          <Button label="Discard changes" variant="quiet" onPress={onClose} />
          <Button label="Save equipment" onPress={() => onSave(draft)} testID="inventory-save" />
        </ButtonRow>
      }
    >
      <View style={{ gap: space.xl }}>
        <View>
          <CheckRow
            label="Barbell"
            checked={draft.barbell}
            onToggle={(next) => patch({ barbell: next })}
          />
          <CheckRow
            label="Squat rack"
            detail="A barbell, a rack and plates together are weight-room access."
            checked={draft.rack}
            onToggle={(next) => patch({ rack: next })}
          />
          <CheckRow
            label="Trap bar"
            checked={draft.trapBar}
            onToggle={(next) => patch({ trapBar: next })}
          />
        </View>

        <Stepper
          label="Smallest plate pair"
          value={draft.plates.smallestPairLb}
          onChange={(next) => patch({ plates: { smallestPairLb: next } })}
          step={1.25}
          min={1.25}
          max={45}
          suffix="lb"
          format={(entry) => (entry % 1 === 0 ? formatInteger(entry) : entry.toFixed(2))}
          helper="The load grid every barbell prescription is rounded to."
        />

        <View>
          <CheckRow
            label="Dumbbells"
            checked={dumbbells !== null}
            onToggle={(next) =>
              patch({ dumbbells: next ? { maxLb: 50, incrementLb: 5 } : null })
            }
          />
          <CheckRow
            label="Kettlebells"
            checked={draft.kettlebells}
            onToggle={(next) => patch({ kettlebells: next })}
          />
        </View>

        {dumbbells === null ? null : (
          <View style={{ gap: space.lg }}>
            <Stepper
              label="Heaviest dumbbell"
              value={dumbbells.maxLb}
              onChange={(next) => patch({ dumbbells: { ...dumbbells, maxLb: next } })}
              step={5}
              min={5}
              max={200}
              suffix="lb"
              format={formatInteger}
            />
            <Stepper
              label="Dumbbell increment"
              value={dumbbells.incrementLb}
              onChange={(next) => patch({ dumbbells: { ...dumbbells, incrementLb: next } })}
              step={2.5}
              min={2.5}
              max={10}
              suffix="lb"
              format={(entry) => (entry % 1 === 0 ? formatInteger(entry) : entry.toFixed(1))}
            />
          </View>
        )}

        <HeightChips
          label="Box heights"
          detail="Every height you can actually step onto. These are the ladder rungs."
          options={BOX_HEIGHTS}
          selected={draft.boxHeightsIn}
          onToggle={(height) => toggleHeight('boxHeightsIn', height)}
        />

        <HeightChips
          label="Hurdle heights"
          detail="Leave empty if you have none."
          options={HURDLE_HEIGHTS}
          selected={draft.hurdleHeightsIn}
          onToggle={(height) => toggleHeight('hurdleHeightsIn', height)}
        />

        <View>
          <CheckRow
            label="Bands"
            checked={draft.bands}
            onToggle={(next) => patch({ bands: next })}
          />
          <CheckRow
            label="Med ball"
            checked={draft.medBall}
            onToggle={(next) => patch({ medBall: next })}
          />
          <CheckRow
            label="Weight vest"
            checked={draft.vestLb !== undefined}
            onToggle={(next) => setDraft((current) => withVest(current, next))}
          />
        </View>

        {draft.vestLb === undefined ? null : (
          <Stepper
            label="Vest load"
            value={draft.vestLb}
            onChange={(next) => patch({ vestLb: next })}
            step={5}
            min={5}
            max={80}
            suffix="lb"
            format={formatInteger}
          />
        )}

        <View>
          <CheckRow
            label="Bench"
            checked={draft.bench}
            onToggle={(next) => patch({ bench: next })}
          />
          <CheckRow
            label="Pull-up bar"
            checked={draft.pullupBar}
            onToggle={(next) => patch({ pullupBar: next })}
          />
          <CheckRow
            label="Cable machine"
            checked={draft.cable}
            onToggle={(next) => patch({ cable: next })}
          />
          <CheckRow label="Sled" checked={draft.sled} onToggle={(next) => patch({ sled: next })} />
        </View>

        <View>
          <CheckRow
            label="Hangboard"
            detail="Open-hand hangs only, and never within 48 h of another hard finger session."
            checked={draft.hangboard === true}
            onToggle={(next) => patch({ hangboard: next })}
            testID="inventory-hangboard"
          />
          <CheckRow
            label="Box squat box"
            detail="A box at squat height. Without it the box squat is never prescribed."
            checked={draft.boxSquatBox === true}
            onToggle={(next) => patch({ boxSquatBox: next })}
            testID="inventory-box-squat-box"
          />
        </View>

        <Text variant="caption" color="ink3">
          {draft.weightRoomAccess
            ? 'Weight-room access: barbell compounds are available.'
            : 'No weight-room access: the program runs without barbell compounds.'}
        </Text>
      </View>
    </Sheet>
  );
}

export { DEFAULT_INVENTORY };
