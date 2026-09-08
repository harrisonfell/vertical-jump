import { formatRest } from '@vert/engine/units';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { ariaState, useFocusVisible } from '../a11y';
import { Glyph } from '../glyphs';
import { Text } from '../text';
import { opacity, space, useTheme } from '../theme';
import { Button } from './button';
import { ChipRow, type ChipOption } from './chip';
import { FocusRing } from './focusRing';
import { Hairline } from './hairline';
import { Stepper } from './stepper';
import {
  canLog,
  initialSetRowState,
  logResult,
  setRowReducer,
  type LandingQuality,
  type SetRowConfig,
  type SetRowEvent,
  type SetRowKind,
  type SetRowLogResult,
  type SetRowState,
  type SetSide,
} from './setRowState';

export type { LandingQuality, SetRowKind, SetRowLogResult, SetSide };

/** The row grid, from the brief: index, prescription, edit, check. */
export const SET_ROW_GRID = { index: 24, control: 44, gap: space.sm, minHeight: 56 } as const;

const RPE_OPTIONS: readonly ChipOption<number>[] = [6, 7, 8, 9, 10].map((value) => ({
  value,
  label: String(value),
  accessibilityLabel: `RPE ${value}`,
}));

/** The load field is typed into, so it prints the bare number and units go in the suffix. */
function bareLoad(lb: number): string {
  return String(Math.round(lb));
}

export interface SetRowProps {
  /** 1, 2, 3, or "R1" for a ramp set. */
  readonly index: number | string;
  /** From an engine formatter: "5 × 205 lb", "8 × BW", "30 s hold", "15 m". */
  readonly prescription: string;
  /** The muted second line: "each side", "did 4", "was 5 × 235", "capped · knee". */
  readonly detail?: string;
  readonly kind?: SetRowKind;
  /**
   * The log's own answer for this set. It is not just a seed: the tick is
   * optimistic, so whenever the store disagrees the store wins and the row
   * reconciles to it, which is what stops a row that failed to save from
   * sitting green with the athlete believing it is written.
   */
  readonly done?: boolean;
  /** Seconds for a timed row. */
  readonly durationS?: number;
  /** Last set of a height ladder: asks how the landing felt. */
  readonly promptsLanding?: boolean;
  /** RPE mode: the prefilled load, from the last set then the last session. */
  readonly loadLb?: number | null;
  readonly loadStep?: number;
  /** RPE mode: the target effort, marked but never preselected. */
  readonly targetRpe?: number;
  /**
   * A unilateral row: the effort is asked once per leg. The row is still one
   * set and one tap; only the question doubles.
   */
  readonly perSide?: boolean;
  /**
   * The load may be left blank: a bodyweight set with a weight the athlete may
   * add. The row logs with the field empty and the field reads as a plus.
   */
  readonly loadOptional?: boolean;
  /**
   * How the typed load reads in the RPE panel's field. It must return the bare
   * number, with the unit carried by `loadUnit`: the field is controlled on
   * this string, and "205 lb" is not something the numeric parser will take
   * back, so a unit inside it makes every keystroke after the first vanish.
   */
  readonly formatLoad?: (lb: number) => string;
  /** The unit shown after the load field: "lb", "kg". */
  readonly loadUnit?: string;
  readonly onLog?: (result: SetRowLogResult) => void;
  readonly onUndo?: () => void;
  readonly onEdit?: () => void;
  readonly disabled?: boolean;
  /** Opacity-only under reduced motion; this row never animates regardless. */
  readonly testID?: string;
}

/**
 * One set. The whole row is a button: a tap logs it as written. The pencil has
 * its own column outside the row's hit area, so a correction never becomes an
 * accidental log, and the check block is the only green on the screen.
 */
export function SetRow({
  index,
  prescription,
  detail,
  kind = 'loadable',
  done = false,
  durationS,
  promptsLanding = false,
  loadLb = null,
  loadStep = 5,
  targetRpe,
  perSide = false,
  loadOptional = false,
  formatLoad = bareLoad,
  loadUnit = 'lb',
  onLog,
  onUndo,
  onEdit,
  disabled = false,
  testID,
}: SetRowProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();

  const config = useMemo<SetRowConfig>(
    () => ({
      kind,
      ...(durationS === undefined ? null : { durationS }),
      promptsLanding,
      initialLoadLb: loadLb,
      perSide,
      loadOptional,
    }),
    [durationS, kind, loadLb, loadOptional, perSide, promptsLanding],
  );

  const [state, dispatch] = useReducer(
    (current: SetRowState, event: SetRowEvent) => setRowReducer(current, event, config),
    config,
    (initial) => initialSetRowState(initial, done),
  );

  const running = state.phase === 'running';
  const landing = state.phase === 'landing';
  const expanded = state.phase === 'expanded';

  // One tick a second drives both the hold countdown and the landing prompt.
  useEffect(() => {
    if (!running && !landing) return;
    const id = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(id);
  }, [landing, running]);

  // Report outward once, and only when the row crosses into or out of done.
  const wasDone = useRef(state.done);

  // The store's answer, reconciled in whenever it moves under the optimistic
  // tick: a refetch after a failed write, an undo from the edit sheet, a
  // remount when the athlete comes back from Plan. Nothing is reported back
  // outward for a reconcile: the store is where it came from.
  const storeDone = useRef(done);
  useEffect(() => {
    if (storeDone.current === done) return;
    storeDone.current = done;
    if (done === state.done) return;
    wasDone.current = done;
    dispatch({ type: 'reconcile', done });
  }, [done, state.done]);

  useEffect(() => {
    if (wasDone.current === state.done) return;
    wasDone.current = state.done;
    if (state.done) onLog?.(logResult(state));
    else onUndo?.();
  }, [onLog, onUndo, state]);

  const loggable = canLog(state, config);

  const secondLine =
    kind === 'timed'
      ? running
        ? formatRest(state.secondsRemaining ?? 0)
        : state.done
          ? (detail ?? 'held')
          : 'Start'
      : detail;

  const checkGlyph = state.done
    ? 'check'
    : kind === 'timed'
      ? running
        ? 'stop'
        : 'play'
      : null;

  const rowLabel = `Set ${index}, ${prescription}${state.done ? ', done' : ''}`;
  // The row is a toggle button, so ARIA describes it with aria-pressed;
  // aria-checked is not supported on role="button" and is silently dropped,
  // which left the app's main control reporting no done state at all.
  const rowState = { disabled, selected: state.done };

  return (
    <View testID={testID}>
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rowLabel}
          accessibilityState={rowState}
          {...ariaState({ disabled, pressed: state.done })}
          disabled={disabled || landing}
          onPress={() => dispatch({ type: 'press' })}
          onFocus={focusProps.onFocus}
          onBlur={focusProps.onBlur}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: SET_ROW_GRID.gap,
            minHeight: SET_ROW_GRID.minHeight,
            paddingVertical: space.sm,
            backgroundColor: pressed && !disabled ? colors.paper3 : 'transparent',
            opacity: disabled ? opacity.disabled : 1,
          })}
        >
          <FocusRing visible={focusVisible} />

          <Text
            variant="caption"
            color="ink3"
            numeric
            style={{ width: SET_ROW_GRID.index }}
          >
            {String(index)}
          </Text>

          <View style={{ flex: 1, gap: space.xxs }}>
            <Text variant="rowNumber" color={state.done ? 'ink2' : 'ink'}>
              {prescription}
            </Text>
            {secondLine === undefined ? null : (
              <Text variant="caption" color="ink3" numeric={kind === 'timed'}>
                {secondLine}
              </Text>
            )}
          </View>

          {/* The edit column's space, kept out of this button's hit area. */}
          <View style={{ width: SET_ROW_GRID.control, height: SET_ROW_GRID.control }} />

          <View
            style={{
              width: SET_ROW_GRID.control,
              height: SET_ROW_GRID.control,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: state.done ? colors.green : colors.ruleStrong,
              backgroundColor: state.done ? colors.green : 'transparent',
            }}
          >
            {checkGlyph === null ? null : (
              <Glyph name={checkGlyph} color={state.done ? colors.onGreen : colors.ink2} />
            )}
          </View>
        </Pressable>

        {onEdit === undefined ? null : (
          <EditTarget onPress={onEdit} disabled={disabled} label={`Edit set ${index}`} />
        )}
      </View>

      {expanded ? (
        <RpePanel
          load={state.loadLb}
          rpe={state.rpe}
          rpeLeft={state.rpeLeft}
          rpeRight={state.rpeRight}
          perSide={perSide}
          loadOptional={loadOptional}
          step={loadStep}
          format={formatLoad}
          unit={loadUnit}
          {...(targetRpe === undefined ? null : { targetRpe })}
          canLog={loggable}
          onLoad={(value) => dispatch({ type: 'setLoad', loadLb: value })}
          onRpe={(value, side) =>
            dispatch({ type: 'setRpe', rpe: value, ...(side === undefined ? null : { side }) })
          }
          onSubmit={() => dispatch({ type: 'log' })}
        />
      ) : null}

      {landing ? (
        <LandingPrompt
          secondsLeft={state.landingCountdown ?? 0}
          onAnswer={(quality) => dispatch({ type: 'landing', quality })}
        />
      ) : null}

      <Hairline />
    </View>
  );
}

interface EditTargetProps {
  readonly onPress: () => void;
  readonly disabled: boolean;
  readonly label: string;
}

/**
 * The correction control, in its own column, absolutely placed so the row
 * cannot eat it. It says the word: a lone pencil beside a 44px green tick is
 * the one thing in this product that must not be guessed at, since mistaking
 * it for the tick logs a set. Its rule matches the check box beside it.
 */
function EditTarget({ onPress, disabled, label }: EditTargetProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      {...ariaState({ disabled })}
      disabled={disabled}
      onPress={onPress}
      onFocus={focusProps.onFocus}
      onBlur={focusProps.onBlur}
      style={({ pressed }) => ({
        position: 'absolute',
        right: SET_ROW_GRID.control + SET_ROW_GRID.gap,
        top: 0,
        bottom: 0,
        width: SET_ROW_GRID.control,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed && !disabled ? colors.paper3 : 'transparent',
      })}
    >
      <FocusRing visible={focusVisible} />
      <View
        style={{
          width: SET_ROW_GRID.control,
          height: SET_ROW_GRID.control,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.ruleStrong,
        }}
      >
        <Text variant="label" color="ink2">
          Edit
        </Text>
      </View>
    </Pressable>
  );
}

interface RpePanelProps {
  readonly load: number | null;
  readonly rpe: number | null;
  readonly rpeLeft: number | null;
  readonly rpeRight: number | null;
  /** A unilateral row: two effort rows, one per leg, instead of one. */
  readonly perSide: boolean;
  /** The load may be left blank, so the field is a plus and never a gate. */
  readonly loadOptional: boolean;
  readonly step: number;
  readonly format: (lb: number) => string;
  readonly unit: string;
  readonly targetRpe?: number;
  readonly canLog: boolean;
  readonly onLoad: (value: number) => void;
  readonly onRpe: (value: number, side?: SetSide) => void;
  readonly onSubmit: () => void;
}

/** One effort row: its own label, its own chips, its own group for a reader. */
function EffortRow({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (value: number) => void;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label" color="ink2">
        {label}
      </Text>
      <ChipRow options={RPE_OPTIONS} value={value} groupLabel={label} onChange={onChange} />
    </View>
  );
}

/** Week 1 and any lift without a working max: log the weight you used. */
function RpePanel({
  load,
  rpe,
  rpeLeft,
  rpeRight,
  perSide,
  loadOptional,
  step,
  format,
  unit,
  targetRpe,
  canLog: loggable,
  onLoad,
  onRpe,
  onSubmit,
}: RpePanelProps) {
  const target = targetRpe === undefined ? '' : ` · target ${targetRpe}`;
  const effortLabel = `Effort (RPE)${target}`;
  return (
    <View style={{ paddingBottom: space.md, gap: space.md }}>
      <Stepper
        label={loadOptional ? 'Added load (optional)' : 'Load'}
        value={load ?? 0}
        step={step}
        min={0}
        format={format}
        suffix={unit}
        editable
        onChange={onLoad}
        {...(loggable ? { onSubmit } : null)}
      />

      {perSide ? (
        <>
          {/* Two answers, because the same weight is not the same work on both
              legs and the gap between them is what names the weaker side.
              Either may be left blank: an unanswered leg logs no effort rather
              than borrowing the other's. */}
          <EffortRow
            label={`Left leg (RPE)${target}`}
            value={rpeLeft}
            onChange={(value) => onRpe(value, 'left')}
          />
          <EffortRow
            label={`Right leg (RPE)${target}`}
            value={rpeRight}
            onChange={(value) => onRpe(value, 'right')}
          />
        </>
      ) : (
        <EffortRow label={effortLabel} value={rpe} onChange={(value) => onRpe(value)} />
      )}

      <Button
        label="Log set"
        variant="primary"
        disabled={!loggable}
        onPress={onSubmit}
        accessibilityHint={
          loggable
            ? loadOptional
              ? 'Leave the load empty for a bodyweight set'
              : undefined
            : 'Enter the load you used first'
        }
      />
    </View>
  );
}

interface LandingPromptProps {
  readonly secondsLeft: number;
  readonly onAnswer: (quality: LandingQuality) => void;
}

const LANDING_OPTIONS: readonly { readonly quality: LandingQuality; readonly label: string }[] = [
  { quality: 'good', label: 'Good' },
  { quality: 'ok', label: 'OK' },
  { quality: 'poor', label: 'Poor' },
];

/** Five seconds, three answers, Good if nobody says otherwise. */
function LandingPrompt({ secondsLeft, onAnswer }: LandingPromptProps) {
  return (
    <View style={{ paddingBottom: space.md, gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'baseline' }}>
        {/* The question is announced once; the countdown beside it is a timer,
            because a polite live region on a per-second number says it five
            times over and buries the three answers underneath. */}
        <Text variant="caption" color="ink2" accessibilityLiveRegion="polite" aria-live="polite">
          How did that land?
        </Text>
        <Text variant="caption" color="ink3" accessibilityRole="timer" aria-live="off" numeric>
          {`Good in ${secondsLeft} s`}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {LANDING_OPTIONS.map((option) => (
          <Button
            key={option.quality}
            label={option.label}
            variant="secondary"
            onPress={() => onAnswer(option.quality)}
            style={{ flex: 1 }}
          />
        ))}
      </View>
    </View>
  );
}
