import { useState } from 'react';
import { View } from 'react-native';
import { formatHeightIn, formatInteger, formatLoadLb, kgToLb, roundHalfUp } from '@vert/engine';
import type { Athlete } from '@/data';
import { Button, Notice, Sheet, Text, space } from '@/ui';
import { climbingAnswersFrom, showsGripBlock } from '../setup';
import { RowDivider, SettingRow, SettingSection } from './row';
import { DATE_SHAPE, draftFrom, wallWindowLabel, type ProgramDraft } from './programDraft';
import { ProgramSheetBody } from './programSheet';
import {
  CHANGES_YOUR_PROGRAM,
  formatCalendarDate,
  weekdaysLabel,
  type ParamChange,
  type RegenerationPlan,
} from './regenerate';

export { draftFrom, wallWindowLabel, type ProgramDraft };

/**
 * Program parameters, and the confirm that stands between an edit and a
 * rebuild.
 *
 * Nothing on this screen writes on a keystroke. An edit collects a value, the
 * sheet names every field that moves and where the rebuild starts, and only
 * the confirm saves. The refusal path matters as much: a weekday pick that
 * breaks a spacing rule is refused inline, with the rule number, which is one
 * of the two places rule numbers are allowed (brief section 13).
 */

export interface ProgramSectionProps {
  readonly athlete: Athlete;
  /** The pending, unsaved edits laid over the athlete. */
  readonly draft: ProgramDraft;
  readonly onDraft: (draft: ProgramDraft) => void;
  /** Refuses a weekday set in plain words plus its rule number, or null. */
  readonly weekdayRefusal: string | null;
  readonly plan: RegenerationPlan | null;
  readonly onConfirm: () => void;
  readonly onDiscard: () => void;
  readonly saving: boolean;
  readonly error: string | null;
}

export function ProgramSection({
  athlete,
  draft,
  onDraft,
  weekdayRefusal,
  plan,
  onConfirm,
  onDiscard,
  saving,
  error,
}: ProgramSectionProps) {
  const [editing, setEditing] = useState(false);
  const climbing = climbingAnswersFrom(athlete);
  const showClimbing = showsGripBlock(athlete.sport, climbing.fingerHistory);

  const goalError =
    draft.goalText !== '' && draft.goalHeightMm === null
      ? 'Goal height needs a number in inches. Example: 36.0'
      : draft.goalHeightMm !== null &&
          athlete.goalHeightMm !== null &&
          draft.goalHeightMm <= 0
        ? 'Goal height has to be above zero.'
        : undefined;

  const dateError =
    draft.targetText !== '' && !DATE_SHAPE.test(draft.targetText)
      ? 'Target date needs to be YYYY-MM-DD. Example: 2026-11-29'
      : undefined;

  return (
    <SettingSection title="Program" testID="settings-program">
      <SettingRow
        label="Training days"
        value={weekdaysLabel(draft.weekdays)}
        caption={CHANGES_YOUR_PROGRAM}
        chevron
        onPress={() => setEditing(true)}
        testID="settings-weekdays"
      />
      <RowDivider />
      <SettingRow
        label="Goal height"
        value={draft.goalHeightMm === null ? 'Not set' : formatHeightIn(draft.goalHeightMm)}
        caption={CHANGES_YOUR_PROGRAM}
        chevron
        numeric
        onPress={() => setEditing(true)}
        testID="settings-goal"
      />
      <RowDivider />
      <SettingRow
        label="Target date"
        value={draft.targetDate === null ? 'Not set' : formatCalendarDate(draft.targetDate)}
        caption={CHANGES_YOUR_PROGRAM}
        chevron
        numeric
        onPress={() => setEditing(true)}
        testID="settings-target"
      />
      <RowDivider />
      <SettingRow
        label="In-season"
        value={draft.inSeason ? 'Yes' : 'No'}
        caption="Jump contacts halved; change of direction covered by games."
        chevron
        onPress={() => setEditing(true)}
        testID="settings-in-season"
      />
      <RowDivider />
      <SettingRow
        label="Bodyweight"
        value={
          draft.bodyweightKg === null
            ? 'Not set'
            : formatLoadLb(roundHalfUp(kgToLb(draft.bodyweightKg), 0))
        }
        caption="Shown beside tests. Does not change your program."
        chevron
        numeric
        onPress={() => setEditing(true)}
        testID="settings-bodyweight"
      />

      {showClimbing ? (
        <View>
          <RowDivider />
          <SettingRow
            label="Wall work days"
            value={weekdaysLabel(draft.wallWorkDays)}
            caption={CHANGES_YOUR_PROGRAM}
            chevron
            onPress={() => setEditing(true)}
            testID="settings-wall-days"
          />
          <RowDivider />
          <SettingRow
            label="Wall work window"
            value={wallWindowLabel(draft.wallStart, draft.wallEnd)}
            caption="Knee alignment work sits at least 6 h from it."
            chevron
            numeric
            onPress={() => setEditing(true)}
            testID="settings-wall-window"
          />
          <RowDivider />
          <SettingRow
            label="Climbing counts as hard finger work"
            value={draft.wallFingerHard ? 'Yes' : 'No'}
            caption={CHANGES_YOUR_PROGRAM}
            chevron
            onPress={() => setEditing(true)}
            testID="settings-wall-finger"
          />
          <RowDivider />
          <SettingRow
            label="Same-day gym and climbing gap"
            value={`${formatInteger(draft.wallGapHours)} h`}
            caption="Gym pulling and the wall may share a day when they are this far apart."
            chevron
            numeric
            onPress={() => setEditing(true)}
            testID="settings-wall-gap"
          />
          <RowDivider />
          <SettingRow
            label="Valgus control (RNT) twice a week"
            value={draft.valgusControl ? 'On' : 'Off'}
            caption={CHANGES_YOUR_PROGRAM}
            chevron
            onPress={() => setEditing(true)}
            testID="settings-valgus"
          />
        </View>
      ) : null}

      <Sheet
        visible={editing}
        onClose={() => setEditing(false)}
        title="Program parameters"
        subtitle="Nothing is saved until you confirm."
        actions={
          <Button
            label="Review changes"
            variant="primary"
            fullWidth
            disabled={goalError !== undefined || dateError !== undefined || weekdayRefusal !== null}
            onPress={() => setEditing(false)}
            testID="settings-review"
          />
        }
      >
        <ProgramSheetBody
          draft={draft}
          onDraft={onDraft}
          weekdayRefusal={weekdayRefusal}
          goalError={goalError}
          dateError={dateError}
          showClimbing={showClimbing}
        />
      </Sheet>

      <RegenerateSheet
        plan={plan}
        saving={saving}
        error={error}
        onConfirm={onConfirm}
        onDiscard={onDiscard}
      />
    </SettingSection>
  );
}

export interface RegenerateSheetProps {
  readonly plan: RegenerationPlan | null;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onDiscard: () => void;
}

/** "Regenerate from Week 8?" with every field that moves, before anything saves. */
export function RegenerateSheet({
  plan,
  saving,
  error,
  onConfirm,
  onDiscard,
}: RegenerateSheetProps) {
  return (
    <Sheet
      visible={plan !== null}
      onClose={onDiscard}
      title={plan?.title ?? ''}
      closeLabel="Keep the current plan"
      actions={
        <Button
          label={plan?.confirmLabel ?? 'Save changes'}
          variant="primary"
          fullWidth
          loading={saving}
          onPress={onConfirm}
          testID="settings-regenerate-confirm"
        />
      }
    >
      <View style={{ gap: space.sm }}>
        {(plan?.lines ?? []).map((line) => (
          <Text key={line} variant="body" color="ink2">
            {line}
          </Text>
        ))}
        {error === null ? null : <Notice text={error} live />}
      </View>
    </Sheet>
  );
}

/** The changes the sheet is about, for a caller that wants to log them. */
export function changeSummary(changes: readonly ParamChange[]): string {
  return changes.map((change) => `${change.label}: ${change.from} to ${change.to}`).join(' · ');
}
