import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Sheet, space, useSheet } from '@/ui';
import type { LocalDate } from '@/data';
import {
  BestSetBlock,
  SETUP_COPY,
  bestSetSummary,
  bestSetsHaveErrors,
  maxRowsFor,
  type BestSetField,
  type BestSetValues,
  type BestSetsDraft,
  type SportValue,
} from '../setup';
import { RowDivider, SettingRow } from './row';

/**
 * Settings > Lifts: the best recent set, one row per main lift.
 *
 * The same block setup step 2 uses, in a sheet, so a set typed here means what
 * it meant on the day the program was built. It writes only on Save, and only
 * when every typed set is valid; a blank set is a valid answer and clears the
 * one on file.
 */

export interface BestSetRowsProps {
  readonly sport: SportValue;
  readonly bestSets: BestSetsDraft;
  readonly today: LocalDate;
  readonly onSave: (draft: BestSetsDraft) => void;
  readonly saving?: boolean;
}

export function BestSetRows({ sport, bestSets, today, onSave, saving = false }: BestSetRowsProps) {
  const sheet = useSheet();
  const [draft, setDraft] = useState<BestSetsDraft>(bestSets);
  const [submitted, setSubmitted] = useState(false);

  // The saved answer is the truth: a write elsewhere, or a discarded edit,
  // leaves the sheet showing what is actually on file.
  useEffect(() => {
    if (!sheet.open) setDraft(bestSets);
  }, [bestSets, sheet.open]);

  const refused = bestSetsHaveErrors(draft, today);

  const change = (field: BestSetField, values: BestSetValues): void => {
    setDraft((current) => ({ ...current, [field]: values }));
  };

  return (
    <View>
      {maxRowsFor(sport).map((row) => (
        <View key={row.field}>
          <RowDivider />
          <SettingRow
            label={`Best recent set: ${row.label}`}
            value={bestSetSummary(bestSets[row.field]) ?? 'Not set'}
            caption={SETUP_COPY.stepTwoBestSetCaption}
            chevron
            onPress={sheet.show}
            testID={`settings-best-set-${row.field}`}
          />
        </View>
      ))}

      <Sheet
        visible={sheet.open}
        onClose={sheet.hide}
        title={SETUP_COPY.stepTwoBestSetTitle}
        subtitle={SETUP_COPY.stepTwoBestSetCaption}
        actions={
          <Button
            label="Save best sets"
            variant="primary"
            fullWidth
            loading={saving}
            disabled={refused}
            onPress={() => {
              setSubmitted(true);
              if (refused) return;
              onSave(draft);
              sheet.hide();
            }}
            testID="settings-best-set-save"
          />
        }
      >
        <View style={{ gap: space.lg }}>
          <BestSetBlock
            sport={sport}
            values={draft}
            onChange={change}
            today={today}
            submitted={submitted}
            framed={false}
          />
        </View>
      </Sheet>
    </View>
  );
}
