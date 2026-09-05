import { AnswerGroup, ChipRow, space } from '@/ui';
import { View } from 'react-native';
import { Text } from '@/ui';
import type { Athlete } from '@/data';
import {
  AVAILABILITY_OPTIONS,
  CEILING_MAX,
  CEILING_MIN,
  GRIP_MODE_OPTIONS,
  SECONDARY_GOAL_OPTIONS,
  SPORT_OPTIONS,
  TRAINING_AGE_OPTIONS,
  TRAINING_AGE_YEARS,
  WEAKER_SIDE_OPTIONS,
  climbingAnswersFrom,
  trainingAgeFromYears,
  type GripModeValue,
  type TrainingAgeValue,
  type WeakerSideValue,
} from '../setup';
import type { AthleteAnswer } from './athleteAnswer';

/**
 * What the Athlete section's edit sheet holds, one editor at a time.
 *
 * Every control here is the one setup used to ask the same question, imported
 * rather than rewritten: an answer has to mean the same thing on the day it is
 * changed as it did on the day it was first given. Nothing writes; each editor
 * hands its answer back and the screen shows the regeneration confirm.
 */

export type AthleteEditorKind =
  | 'sport'
  | 'secondGoal'
  | 'trainingAge'
  | 'days'
  | 'fingerHistory'
  | 'grip'
  | 'ceiling'
  | 'weakerSide';

export const EDITOR_TITLE: Readonly<Record<AthleteEditorKind, string>> = {
  sport: 'Sport',
  secondGoal: 'Second goal',
  trainingAge: 'Training age',
  days: 'Availability',
  fingerHistory: 'Finger or pulley injury history',
  grip: 'Grip on pulling movements',
  ceiling: 'Finger pain ceiling',
  weakerSide: 'Weaker side',
};

const CEILING_OPTIONS = Array.from(
  { length: CEILING_MAX - CEILING_MIN + 1 },
  (_unused, index) => ({ value: CEILING_MIN + index, label: `${CEILING_MIN + index}` }),
);

export interface AthleteEditorProps {
  readonly editor: AthleteEditorKind;
  readonly athlete: Athlete;
  readonly onAnswer: (answer: AthleteAnswer) => void;
  readonly onClose: () => void;
}

export function AthleteEditor({ editor, athlete, onAnswer, onClose }: AthleteEditorProps) {
  const climbing = climbingAnswersFrom(athlete);
  const answer = (next: AthleteAnswer): void => {
    onAnswer(next);
    onClose();
  };

  if (editor === 'sport') {
    return (
      <AnswerGroup
        groupLabel="Sport"
        options={SPORT_OPTIONS}
        value={athlete.sport as (typeof SPORT_OPTIONS)[number]['value'] | null}
        onChange={(value) => answer({ field: 'sport', value })}
      />
    );
  }

  if (editor === 'secondGoal') {
    return (
      <AnswerGroup
        groupLabel="Second goal"
        options={SECONDARY_GOAL_OPTIONS}
        value={climbing.secondaryGoal ?? 'none'}
        onChange={(value) =>
          answer({ field: 'secondaryGoal', value: value === 'none' ? null : value })
        }
      />
    );
  }

  if (editor === 'trainingAge') {
    return (
      <AnswerGroup
        groupLabel="Training age"
        options={TRAINING_AGE_OPTIONS}
        value={trainingAgeFromYears(athlete.trainingAgeYears)}
        onChange={(value: TrainingAgeValue) =>
          answer({ field: 'trainingAgeYears', value: TRAINING_AGE_YEARS[value] })
        }
      />
    );
  }

  if (editor === 'days') {
    return (
      <AnswerGroup
        groupLabel="Days a week"
        options={AVAILABILITY_OPTIONS}
        value={athlete.daysPerWeek as 2 | 3 | 4 | 5 | null}
        onChange={(value) => answer({ field: 'daysPerWeek', value })}
      />
    );
  }

  if (editor === 'fingerHistory') {
    return (
      <AnswerGroup
        groupLabel="Finger or pulley injury history"
        options={[
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
        ]}
        value={climbing.fingerHistory ? 'yes' : 'no'}
        onChange={(value) => answer({ field: 'fingerHistory', value: value === 'yes' })}
      />
    );
  }

  if (editor === 'grip') {
    return (
      <AnswerGroup<GripModeValue>
        groupLabel="Grip on pulling movements"
        options={GRIP_MODE_OPTIONS}
        value={climbing.gripMode}
        onChange={(value) => answer({ field: 'gripMode', value })}
      />
    );
  }

  if (editor === 'ceiling') {
    return (
      <View style={{ gap: space.sm }}>
        <Text variant="caption" color="ink3">
          At or above this, hard finger work comes off the day.
        </Text>
        <ChipRow
          groupLabel="Finger pain ceiling"
          options={CEILING_OPTIONS}
          value={climbing.fingerPainCeiling}
          splitAfter={6}
          onChange={(value) => answer({ field: 'fingerPainCeiling', value })}
        />
      </View>
    );
  }

  return (
    <AnswerGroup<WeakerSideValue>
      groupLabel="Weaker side"
      options={WEAKER_SIDE_OPTIONS}
      value={climbing.weakerSide}
      onChange={(value) =>
        answer({ field: 'weakerSide', value: value === 'unsure' ? null : value })
      }
    />
  );
}
