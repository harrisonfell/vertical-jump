import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { readClearance, href } from '@/app';
import type { Athlete, PainStatus } from '@/data';
import { Button, Chip, ChipRow, Notice, Sheet, Text, space, useSheet } from '@/ui';
import {
  PAIN_DURATION_OPTIONS,
  SECONDARY_GOAL_OPTIONS,
  SPORT_OPTIONS,
  WEAKER_SIDE_OPTIONS,
  climbingAnswersFrom,
  showsGripBlock,
} from '../setup';
import { AthleteEditor, EDITOR_TITLE, type AthleteEditorKind } from './athleteEditor';
import type { AthleteAnswer } from './athleteAnswer';
import { RowDivider, SettingRow, SettingSection } from './row';
import { CHANGES_YOUR_PROGRAM, shortCalendarDate, trainingAgeLabel } from './regenerate';

/**
 * The Athlete section: the five onboarding answers, pain, the age flag, and
 * clearance.
 *
 * Every answer here changes the program, so every row says so, and none of
 * them writes on its own: an edit collects the new answer and hands it back,
 * and the screen shows the regeneration confirm before anything is saved. Pain
 * is the exception the rule book insists on, and it is handled by its own row.
 *
 * The option lists, the training-age table and the engine adapter all come
 * from `src/features/setup`: an answer has to mean the same thing here as it
 * did on the day it was first given, and two copies of a list is how that
 * stops being true.
 */

export type { AthleteAnswer };

export interface AthleteSectionProps {
  readonly athlete: Athlete;
  readonly pain: readonly PainStatus[];
  /** Collects an edited answer. Saving is the screen's decision, not this one. */
  readonly onAnswer: (answer: AthleteAnswer) => void;
  readonly onReassessPain: (pain: PainStatus) => void;
  readonly onReportPain: () => void;
}

const SEVERITY_WORDS: Readonly<Record<string, string>> = {
  mild: '1-2',
  moderate: '3-4',
  severe: '5+',
};

/**
 * The sport in the words it was offered in. A sport saved before the list was
 * narrowed is still shown by name rather than as "Not set": the answer on file
 * is a real answer even when it is no longer on the list.
 */
function sportLabel(sport: string | null): string {
  const offered = SPORT_OPTIONS.find((entry) => entry.value === sport);
  if (offered !== undefined) return offered.label;
  if (sport === null || sport === '') return 'Not set';
  const words = sport.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function secondGoalLabel(value: string | null): string {
  return SECONDARY_GOAL_OPTIONS.find((entry) => entry.value === value)?.label ?? 'None';
}

function weakerSideLabel(value: string | null): string {
  return WEAKER_SIDE_OPTIONS.find((entry) => entry.value === (value ?? 'unsure'))?.label ?? 'Not sure';
}

function locationLabel(location: string): string {
  const words = location.replace(/_/g, ' and ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Knee · 3-4 · ongoing · reported 8 Oct". */
export function painLine(pain: PainStatus): string {
  const parts = [
    locationLabel(pain.location),
    SEVERITY_WORDS[pain.severityDerived] ?? pain.severityDerived,
    pain.onset === 'acute' ? 'new' : 'ongoing',
    `reported ${shortCalendarDate(pain.reportedAt)}`,
  ];
  return parts.join(' · ');
}

type Editor = AthleteEditorKind | null;

export function AthleteSection({
  athlete,
  pain,
  onAnswer,
  onReassessPain,
  onReportPain,
}: AthleteSectionProps) {
  const router = useRouter();
  const sheet = useSheet();
  const [editor, setEditor] = useState<Editor>(null);

  const clearance = useMemo(() => readClearance(athlete.clearance), [athlete.clearance]);
  const active = pain.filter((entry) => entry.clearedAt === null);
  const climbing = climbingAnswersFrom(athlete);
  const showGrip = showsGripBlock(athlete.sport, climbing.fingerHistory);

  const open = (which: Exclude<Editor, null>): void => {
    setEditor(which);
    sheet.show();
  };

  const close = (): void => {
    sheet.hide();
    setEditor(null);
  };

  const clearanceValue = !clearance.answered
    ? 'Not answered'
    : clearance.failed && !clearance.clearedByClinician
      ? 'Clinician clearance needed'
      : clearance.failed
        ? 'Cleared by a clinician'
        : 'Self-screen passed';

  return (
    <SettingSection title="Athlete" testID="settings-athlete">
      <SettingRow
        label="Goal"
        value="Vertical jump"
        caption="Fixed for this program. A new goal starts a new program."
      />
      <RowDivider />
      <SettingRow
        label="Sport"
        value={sportLabel(athlete.sport)}
        caption={CHANGES_YOUR_PROGRAM}
        chevron
        onPress={() => open('sport')}
        testID="settings-sport"
      />
      <RowDivider />
      <SettingRow
        label="Second goal"
        value={secondGoalLabel(climbing.secondaryGoal)}
        caption={CHANGES_YOUR_PROGRAM}
        chevron
        onPress={() => open('secondGoal')}
        testID="settings-second-goal"
      />
      <RowDivider />
      <SettingRow
        label="Training age"
        value={trainingAgeLabel(athlete.trainingAgeYears)}
        caption={CHANGES_YOUR_PROGRAM}
        chevron
        onPress={() => open('trainingAge')}
        testID="settings-training-age"
      />
      <RowDivider />
      <SettingRow
        label="Availability"
        value={athlete.daysPerWeek === null ? 'Not set' : `${athlete.daysPerWeek} days a week`}
        caption={CHANGES_YOUR_PROGRAM}
        chevron
        onPress={() => open('days')}
        testID="settings-days"
        numeric
      />
      <RowDivider />

      {active.length === 0 ? (
        <SettingRow
          label="Pain"
          value="None reported"
          caption={CHANGES_YOUR_PROGRAM}
          chevron
          onPress={onReportPain}
          testID="settings-pain"
        />
      ) : (
        active.map((entry) => (
          <View key={entry.id}>
            <SettingRow
              label="Pain"
              value={SEVERITY_WORDS[entry.severityDerived] ?? entry.severityDerived}
              caption={`${painLine(entry)} · ${CHANGES_YOUR_PROGRAM}`}
              testID={`settings-pain-${entry.location}`}
            >
              <View style={{ flexDirection: 'row', gap: space.sm, paddingTop: space.sm }}>
                <Button
                  label="Reassess now"
                  variant="secondary"
                  onPress={() => onReassessPain(entry)}
                  testID={`settings-reassess-${entry.location}`}
                />
              </View>
            </SettingRow>
            {entry.houseRule ? (
              <Notice
                text={`${locationLabel(entry.location)} pain: no rule-book rule exists. House rule applied: no high-intensity jumps or sprints, ${locationLabel(entry.location).toLowerCase()} exercises capped at 80%, ${locationLabel(entry.location).toLowerCase()} prehab weekly.`}
              />
            ) : null}
            <RowDivider />
          </View>
        ))
      )}

      <RowDivider />
      <SettingRow
        label="Finger or pulley injury history"
        value={climbing.fingerHistory ? 'Yes' : 'No'}
        caption={CHANGES_YOUR_PROGRAM}
        chevron
        onPress={() => open('fingerHistory')}
        testID="settings-finger-history"
      />
      {showGrip ? (
        <View>
          <RowDivider />
          <SettingRow
            label="Grip on pulling movements"
            value={climbing.gripMode === 'open_hand' ? 'Open hand only' : 'Any'}
            caption={CHANGES_YOUR_PROGRAM}
            chevron
            onPress={() => open('grip')}
            testID="settings-grip"
          />
          <RowDivider />
          <SettingRow
            label="Finger pain ceiling"
            value={`${climbing.fingerPainCeiling} / 10`}
            caption={CHANGES_YOUR_PROGRAM}
            chevron
            numeric
            onPress={() => open('ceiling')}
            testID="settings-finger-ceiling"
          />
          <RowDivider />
          <SettingRow
            label="Weaker side"
            value={weakerSideLabel(climbing.weakerSide === 'unsure' ? null : climbing.weakerSide)}
            caption={CHANGES_YOUR_PROGRAM}
            chevron
            onPress={() => open('weakerSide')}
            testID="settings-weaker-side"
          />
        </View>
      ) : null}
      <RowDivider />
      <SettingRow
        label="18 or older"
        value={athlete.isAdult ? 'Yes' : 'No'}
        caption={
          athlete.isAdult
            ? 'No age cap applies.'
            : 'Under 18: maximal loading is capped at 90% effort.'
        }
      />
      <RowDivider />
      <SettingRow
        label="Medical clearance"
        value={clearanceValue}
        caption={
          clearance.failed && !clearance.clearedByClinician
            ? 'No program is built until a clinician clears you.'
            : 'You will be asked again if anything changes.'
        }
        chevron
        onPress={() => router.push(href('/clearance'))}
        testID="settings-clearance"
      />

      <Sheet
        visible={sheet.open}
        onClose={close}
        title={editor === null ? '' : EDITOR_TITLE[editor]}
        subtitle={CHANGES_YOUR_PROGRAM}
      >
        {editor === null ? null : (
          <AthleteEditor
            editor={editor}
            athlete={athlete}
            onAnswer={onAnswer}
            onClose={close}
          />
        )}
      </Sheet>
    </SettingSection>
  );
}

/** The reassessment sheet's two questions (brief section 13, verbatim). */
export const REASSESS_QUESTION = 'How is it now?';
export const REASSESS_DURATION_QUESTION = 'How long has it bothered you?';

export interface ReassessSheetProps {
  readonly visible: boolean;
  readonly pain: PainStatus | null;
  readonly onClose: () => void;
  readonly onAnswer: (severity: '1-2' | '3-4' | '5+' | 'gone', durationWeeks: number) => void;
}

/** "Knee check. Two weeks ago you reported ... How is it now? Gone · 1-2 ..." */
export function ReassessSheet({ visible, pain, onClose, onAnswer }: ReassessSheetProps) {
  const [severity, setSeverity] = useState<'gone' | '1-2' | '3-4' | '5+' | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  if (pain === null) return null;
  const site = locationLabel(pain.location);
  const onset = pain.onset === 'acute' ? 'new' : 'ongoing';
  const grade = SEVERITY_WORDS[pain.severityDerived] ?? pain.severityDerived;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`${site} check`}
      subtitle={`Two weeks ago you reported ${onset}, ${grade} ${site.toLowerCase()} pain and the program ran it as moderate.`}
      actions={
        <Button
          label="Save answer"
          variant="primary"
          fullWidth
          disabled={severity === null || (severity !== 'gone' && duration === null)}
          onPress={() => {
            if (severity === null) return;
            onAnswer(severity, severity === 'gone' ? 0 : (duration ?? 0));
          }}
          testID="reassess-save"
        />
      }
    >
      <View style={{ gap: space.lg }}>
        <View style={{ gap: space.sm }}>
          <Text variant="body">{REASSESS_QUESTION}</Text>
          <ChipRow
            groupLabel={REASSESS_QUESTION}
            options={[
              { value: 'gone', label: 'Gone' },
              { value: '1-2', label: '1-2' },
              { value: '3-4', label: '3-4' },
              { value: '5+', label: '5+' },
            ]}
            value={severity}
            onChange={setSeverity}
          />
        </View>
        {severity === null || severity === 'gone' ? null : (
          <View style={{ gap: space.sm }}>
            <Text variant="body">{REASSESS_DURATION_QUESTION}</Text>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {PAIN_DURATION_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  role="radio"
                  selected={duration === (option.value === 'chronic' ? 12 : 6)}
                  onPress={() => setDuration(option.value === 'chronic' ? 12 : 6)}
                />
              ))}
            </View>
          </View>
        )}
      </View>
    </Sheet>
  );
}
