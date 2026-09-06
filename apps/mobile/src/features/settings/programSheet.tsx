import { View } from 'react-native';
import { inToMm, lbToKg } from '@vert/engine';
import { formatInteger } from '@vert/engine';
import { Chip, DateField, Field, Notice, Stepper, Text, space } from '@/ui';
import {
  WALL_GAP_MAX,
  WALL_GAP_MIN,
  WEEKDAY_CHIPS,
  validateClimbing,
  validateClockWindow,
  climbingDefaults,
} from '../setup';
import type { ProgramDraft } from './programDraft';
import { DATE_SHAPE } from './programDraft';

/**
 * The program-parameter sheet's contents.
 *
 * It is a form, not a save: every control edits the draft and nothing writes
 * until the regeneration confirm. The wall-work rows sit here rather than
 * under Athlete because they are a calendar fact about the week, and the RNT
 * row is placed against them (`house.sc.rnt_valgus_control`).
 */

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface ProgramSheetBodyProps {
  readonly draft: ProgramDraft;
  readonly onDraft: (draft: ProgramDraft) => void;
  readonly weekdayRefusal: string | null;
  readonly goalError: string | undefined;
  readonly dateError: string | undefined;
  /** Speed climbing and finger histories only: the wall and RNT questions. */
  readonly showClimbing: boolean;
}

export function ProgramSheetBody({
  draft,
  onDraft,
  weekdayRefusal,
  goalError,
  dateError,
  showClimbing,
}: ProgramSheetBodyProps) {
  const toggleWeekday = (day: number): void => {
    const next = draft.weekdays.includes(day)
      ? draft.weekdays.filter((entry) => entry !== day)
      : [...draft.weekdays, day].sort((a, b) => a - b);
    onDraft({ ...draft, weekdays: next });
  };

  const toggleWallDay = (day: number): void => {
    const next = draft.wallWorkDays.includes(day)
      ? draft.wallWorkDays.filter((entry) => entry !== day)
      : [...draft.wallWorkDays, day].sort((a, b) => a - b);
    onDraft({ ...draft, wallWorkDays: next });
  };

  const climbing = validateClimbing({
    ...climbingDefaults(),
    wallWorkDays: draft.wallWorkDays,
    wallStart: draft.wallStart,
    wallEnd: draft.wallEnd,
    wallFingerHard: draft.wallFingerHard,
    wallGapHours: draft.wallGapHours,
    valgusControl: draft.valgusControl,
  });
  const gym = validateClockWindow(draft.gymStart, draft.gymEnd);

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <Text variant="label" color="ink3">
          Training days
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {WEEKDAY_LABELS.map((label, index) => (
            <Chip
              key={label}
              label={label}
              role="checkbox"
              selected={draft.weekdays.includes(index)}
              onPress={() => toggleWeekday(index)}
            />
          ))}
        </View>
        {weekdayRefusal === null ? null : <Notice text={weekdayRefusal} live />}
      </View>

      {showClimbing ? (
        <View style={{ gap: space.lg }}>
          <Field
            label="Gym session starts"
            value={draft.gymStart}
            placeholder="08:00"
            maxLength={5}
            testID="settings-gym-start"
            {...(gym.start === undefined
              ? { helper: 'Use a 24-hour time, for example 08:00.' }
              : { error: gym.start })}
            onChangeText={(text) => onDraft({ ...draft, gymStart: text })}
          />
          <Field
            label="Gym session ends"
            value={draft.gymEnd}
            placeholder="10:00"
            maxLength={5}
            testID="settings-gym-end"
            {...(gym.end === undefined
              ? {
                  helper:
                    'Hard pulling shares a climbing day only when the gym clears the wall by the same-day gap. Blank assumes 17:00 to 19:00.',
                }
              : { error: gym.end })}
            onChangeText={(text) => onDraft({ ...draft, gymEnd: text })}
          />
        </View>
      ) : null}

      <Field
        label="Goal height"
        value={draft.goalText}
        numeric
        suffix="in"
        placeholder="36.0"
        {...(goalError === undefined ? null : { error: goalError })}
        onChangeText={(text) => {
          const parsed = Number(text.replace(',', '.'));
          onDraft({
            ...draft,
            goalText: text,
            goalHeightMm: text.trim() === '' || !Number.isFinite(parsed) ? null : inToMm(parsed),
          });
        }}
      />

      <DateField
        label="Target date"
        value={draft.targetText}
        placeholder="2026-11-29"
        emptyLabel="Pick a date"
        {...(dateError === undefined ? { helper: 'At least two weeks out.' } : { error: dateError })}
        onChangeText={(text) => {
          onDraft({ ...draft, targetText: text, targetDate: DATE_SHAPE.test(text) ? text : null });
        }}
      />

      <View style={{ gap: space.sm }}>
        <Text variant="label" color="ink3">
          In-season
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Chip
            label="Yes"
            role="radio"
            selected={draft.inSeason}
            onPress={() => onDraft({ ...draft, inSeason: true })}
          />
          <Chip
            label="No"
            role="radio"
            selected={!draft.inSeason}
            onPress={() => onDraft({ ...draft, inSeason: false })}
          />
        </View>
      </View>

      <Field
        label="Bodyweight"
        value={draft.bodyweightText}
        numeric
        suffix="lb"
        placeholder="180"
        onChangeText={(text) => {
          const parsed = Number(text.replace(',', '.'));
          onDraft({
            ...draft,
            bodyweightText: text,
            bodyweightKg: text.trim() === '' || !Number.isFinite(parsed) ? null : lbToKg(parsed),
          });
        }}
      />

      {showClimbing ? (
        <View style={{ gap: space.lg }}>
          <View style={{ gap: space.sm }}>
            <Text variant="label" color="ink3">
              Wall work days
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {WEEKDAY_CHIPS.map((day) => (
                <Chip
                  key={day.value}
                  label={day.label}
                  role="checkbox"
                  selected={draft.wallWorkDays.includes(day.value)}
                  onPress={() => toggleWallDay(day.value)}
                  testID={`settings-wall-day-${day.value}`}
                />
              ))}
            </View>
          </View>

          <Field
            label="Wall work starts"
            value={draft.wallStart}
            placeholder="18:00"
            maxLength={5}
            testID="settings-wall-start"
            {...(climbing.errors.wallStart === undefined
              ? { helper: 'Use a 24-hour time, for example 18:00.' }
              : { error: climbing.errors.wallStart })}
            onChangeText={(text) => onDraft({ ...draft, wallStart: text })}
          />
          <Field
            label="Wall work ends"
            value={draft.wallEnd}
            placeholder="20:00"
            maxLength={5}
            testID="settings-wall-end"
            {...(climbing.errors.wallEnd === undefined
              ? { helper: 'Knee alignment work sits at least 6 h from this window.' }
              : { error: climbing.errors.wallEnd })}
            onChangeText={(text) => onDraft({ ...draft, wallEnd: text })}
          />

          <View style={{ gap: space.sm }}>
            <Text variant="label" color="ink3">
              Climbing counts as hard finger work
            </Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Chip
                label="Yes"
                role="radio"
                selected={draft.wallFingerHard}
                onPress={() => onDraft({ ...draft, wallFingerHard: true })}
                testID="settings-wall-finger-yes"
              />
              <Chip
                label="No"
                role="radio"
                selected={!draft.wallFingerHard}
                onPress={() => onDraft({ ...draft, wallFingerHard: false })}
                testID="settings-wall-finger-no"
              />
            </View>
          </View>

          <Stepper
            label="Same-day gym and climbing gap"
            value={draft.wallGapHours}
            onChange={(next) => onDraft({ ...draft, wallGapHours: next })}
            step={1}
            min={WALL_GAP_MIN}
            max={WALL_GAP_MAX}
            suffix="h"
            format={formatInteger}
            {...(climbing.errors.wallGapHours === undefined
              ? { helper: 'Gym pulling and the wall may share a day when they are this far apart.' }
              : { error: climbing.errors.wallGapHours })}
            testID="settings-wall-gap"
          />

          <View style={{ gap: space.sm }}>
            <Text variant="label" color="ink3">
              Valgus control (RNT) twice a week
            </Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Chip
                label="On"
                role="radio"
                selected={draft.valgusControl}
                onPress={() => onDraft({ ...draft, valgusControl: true })}
              />
              <Chip
                label="Off"
                role="radio"
                selected={!draft.valgusControl}
                onPress={() => onDraft({ ...draft, valgusControl: false })}
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
