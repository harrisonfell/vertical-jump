import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { href } from '@/app';
// A deep import on purpose: the app barrel pulls the whole shell in behind it,
// and this screen wants one hook out of it.
import { useOwnerPrefill } from '@/app/ownerPrefill';
import { useAthlete, useDbReady, useDbState, useToday, useUpdateAthlete } from '@/data';
import { Button, Chip, Notice, Screen, Skeleton, Text, space } from '@/ui';
import { SETUP_COPY } from './copy';
import { readClearanceAnswers } from './engineAthlete';
import {
  ADULT_QUESTION,
  GATE_QUESTIONS,
  RED_FLAG_KEYS,
  YES_NO,
  type RedFlagKey,
} from './questions';
import { Question, StepFrame } from './parts';

/**
 * Gate 0: the seven PAR-Q+ screening questions and "Are you 18 or older?".
 *
 * Any yes on the seven blocks generation until a clinician clears it (R2), and
 * the profile is saved either way, so the answers are never lost to a routing
 * decision. Under 18 caps maximal loading at 90% effort (R1); it does not
 * block anything.
 */

type Answer = 'no' | 'yes' | null;
type Answers = Record<RedFlagKey, Answer>;

function emptyAnswers(): Answers {
  return {
    heartCondition: null,
    chestPain: null,
    dizziness: null,
    chronicCondition: null,
    prescriptionMedication: null,
    boneOrJointProblem: null,
    supervisedActivityOnly: null,
  };
}

interface YesNoProps {
  readonly value: Answer;
  readonly onChange: (value: 'no' | 'yes') => void;
  readonly label: string;
}

function YesNo({ value, onChange, label }: YesNoProps) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', gap: space.sm }}
    >
      {YES_NO.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          selected={value === option.value}
          onPress={() => onChange(option.value)}
          accessibilityLabel={`${label} ${option.label}`}
        />
      ))}
    </View>
  );
}

export function GateScreen() {
  const router = useRouter();
  const today = useToday();
  const { ready } = useDbReady();
  const { timezone } = useDbState();
  // The owner's boot write lands in the athlete row this screen prefills from,
  // so the questions wait for it rather than opening unanswered beside it.
  const prefill = useOwnerPrefill();
  const athlete = useAthlete();
  const update = useUpdateAthlete();

  const stored = athlete.data;
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [adult, setAdult] = useState<Answer>(null);
  const [touched, setTouched] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Prefill once, from whatever is already on file. A second visit to the gate
  // is a correction, not a fresh interrogation.
  useEffect(() => {
    if (loaded || stored == null) return;
    const existing = readClearanceAnswers(stored.clearance, stored.isAdult);
    if (existing.attestedAt !== undefined) {
      const next = emptyAnswers();
      for (const key of RED_FLAG_KEYS) next[key] = existing[key] ? 'yes' : 'no';
      setAnswers(next);
      setAdult(existing.isAdult ? 'yes' : 'no');
    }
    setLoaded(true);
  }, [loaded, stored]);

  const complete = useMemo(
    () => adult !== null && RED_FLAG_KEYS.every((key) => answers[key] !== null),
    [answers, adult],
  );
  const anyYes = RED_FLAG_KEYS.some((key) => answers[key] === 'yes');

  const save = useCallback(() => {
    setTouched(true);
    if (!complete) return;
    const flags: Record<string, unknown> = { attestedAt: today, isAdult: adult === 'yes' };
    for (const key of RED_FLAG_KEYS) flags[key] = answers[key] === 'yes';
    const existing = readClearanceAnswers(stored?.clearance, stored?.isAdult ?? true);
    if (existing.clearedByClinicianAt !== undefined) {
      flags['clearedByClinicianAt'] = existing.clearedByClinicianAt;
    }

    update.mutate(
      { clearance: flags, isAdult: adult === 'yes', timezone },
      {
        onSuccess: () => {
          router.replace(href(anyYes ? '/clearance' : '/setup/one'));
        },
      },
    );
  }, [adult, answers, anyYes, complete, router, stored, timezone, today, update]);

  if (!ready || !prefill.settled || athlete.isPending) {
    return (
      <Screen testID="setup-gate-loading">
        <Skeleton skeletonFor="header" />
        <Skeleton skeletonFor="line" count={8} />
      </Screen>
    );
  }

  return (
    <Screen testID="setup-gate">
      <StepFrame title={SETUP_COPY.gateTitle} lead={SETUP_COPY.gateLead}>
        <View style={{ gap: space.xl }}>
          {GATE_QUESTIONS.map((question) => (
            <Question
              key={question.key}
              label={question.text}
              {...(question.detail === undefined ? null : { detail: question.detail })}
            >
              <YesNo
                label={question.text}
                value={answers[question.key]}
                onChange={(value) =>
                  setAnswers((current) => ({ ...current, [question.key]: value }))
                }
              />
            </Question>
          ))}

          <Question label={ADULT_QUESTION} detail={SETUP_COPY.gateAdultDetail}>
            <YesNo label={ADULT_QUESTION} value={adult} onChange={setAdult} />
          </Question>
        </View>

        {touched && !complete ? <Notice text={SETUP_COPY.gateUnanswered} live /> : null}
        {update.isError ? (
          <Notice
            text="Couldn't save. Check your connection."
            detail="Your answers are still here."
            actionLabel="Retry"
            onAction={save}
            live
          />
        ) : null}

        <Button
          label={SETUP_COPY.gateSubmit}
          onPress={save}
          fullWidth
          loading={update.isPending}
          testID="setup-gate-save"
        />
        <Text variant="caption" color="ink3">
          {SETUP_COPY.clearanceStillReachable}
        </Text>
      </StepFrame>
    </Screen>
  );
}
