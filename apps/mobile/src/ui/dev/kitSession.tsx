import {
  formatBodyweightSet,
  formatDistance,
  formatHeightValueIn,
  formatHold,
  formatInteger,
  formatLoadedSet,
  inToMm,
} from '@vert/engine/units';
import { View } from 'react-native';
import { Button } from '../primitives/button';
import { ExerciseHeader } from '../primitives/exerciseHeader';
import { Notice } from '../primitives/notice';
import { ResultBlock } from '../primitives/resultBlock';
import { FooterLine, RestBar } from '../primitives/restBar';
import { SetRow } from '../primitives/setRow';
import { Strip, type StripSlot } from '../primitives/strip';
import { space } from '../theme';
import { KitCase, KitSection } from './kitSection';

const noop = (): void => undefined;

/** The three fixed slots, all scored: the day the strap had everything. */
const WHOOP_SLOTS: readonly StripSlot[] = [
  { label: 'Recovery', value: '67%', band: 'high', state: 'value' },
  { label: 'Sleep', value: '84%', detail: '7.2 h', state: 'value' },
  { label: 'Strain', value: '13.4', detail: 'yday 12.4', state: 'value' },
];

/** Recovery not scored yet, sleep in, no cycle for today: one of each state. */
const WHOOP_PARTIAL: readonly StripSlot[] = [
  { label: 'Recovery', value: null, state: 'pending' },
  { label: 'Sleep', value: '84%', detail: '7.2 h', state: 'value' },
  { label: 'Strain', value: null, state: 'noData' },
];

const WHOOP_UNLINKED: readonly StripSlot[] = ['Recovery', 'Sleep', 'Strain'].map((label) => ({
  label,
  value: null,
  state: 'notConnected' as const,
}));

/** The runner's vocabulary: set rows, exercise heads, the strip, the rest bar. */
export function KitSession() {
  return (
    <View style={{ gap: space.lg }}>
      <KitSection
        title="Strip"
        note="Whoop's words, unchanged, with the attribution and the band beside the number."
      >
        <KitCase label="connected">
          <Strip state="connected" slots={WHOOP_SLOTS} syncedAt="6:40" />
        </KitCase>
        <KitCase label="partly scored">
          <Strip state="connected" slots={WHOOP_PARTIAL} syncedAt="6:40" />
        </KitCase>
        <KitCase label="stale">
          <Strip state="stale" slots={WHOOP_SLOTS} staleDays={2} />
        </KitCase>
        <KitCase label="importing">
          <Strip
            state="importing"
            slots={WHOOP_PARTIAL}
            importedDays={40}
            importTotalDays={90}
          />
        </KitCase>
        <KitCase label="revoked">
          <Strip state="revoked" slots={WHOOP_UNLINKED} onAction={noop} />
        </KitCase>
        <KitCase label="not connected">
          <Strip state="notConnected" slots={WHOOP_UNLINKED} onAction={noop} />
        </KitCase>
      </KitSection>

      <KitSection
        title="ExerciseHeader"
        note="Name, the load source line, a 44px Video control, and the folded state."
      >
        <KitCase label="expanded, with a video and a rotation note">
          <ExerciseHeader
            name="Back squat"
            sub="Main lift · heavy strength · entered 275 lb · last 5 × 205 / 4 × 220 / 3 × 235"
            note="New this week · replaces Nordic curl (3 weeks)"
            onVideo={noop}
            onToggle={noop}
          />
        </KitCase>
        <KitCase label="unilateral">
          <ExerciseHeader
            name="Split squat"
            sub="Secondary · hypertrophy · 3 sets"
            bothSides
            onVideo={noop}
          />
        </KitCase>
        <KitCase label="collapsed once every set is logged">
          <ExerciseHeader name="Back squat" collapsed doneLabel="done 5/5" onToggle={noop} />
        </KitCase>
      </KitSection>

      <KitSection
        title="SetRow"
        note="24 | 1fr | 44 | 44, 56px tall. The row is the button; the pencil is not."
      >
        <KitCase label="done, done, undone, undone (the brief's worked squat)">
          <View>
            <SetRow index={1} prescription={formatLoadedSet(5, 205)} detail="done" done onEdit={noop} />
            <SetRow index={2} prescription={formatLoadedSet(4, 220)} detail="done" done onEdit={noop} />
            <SetRow index={3} prescription={formatLoadedSet(3, 235)} onEdit={noop} />
            <SetRow index={4} prescription={formatLoadedSet(3, 235)} onEdit={noop} />
          </View>
        </KitCase>
        <KitCase label="ramp, bodyweight, unilateral, capped">
          <View>
            <SetRow index="R1" prescription={formatLoadedSet(5, 135)} detail="ramp" onEdit={noop} />
            <SetRow index={1} prescription={formatBodyweightSet(8)} onEdit={noop} />
            <SetRow
              index={2}
              prescription={formatBodyweightSet(8, 20)}
              detail="each side"
              onEdit={noop}
            />
            <SetRow
              index={3}
              prescription={formatLoadedSet(3, 185)}
              detail="capped · knee"
              onEdit={noop}
            />
          </View>
        </KitCase>
        <KitCase label="timed and distance">
          <View>
            <SetRow index={1} prescription={formatHold(30)} kind="timed" durationS={30} onEdit={noop} />
            <SetRow
              index={2}
              prescription={formatDistance(15)}
              kind="distance"
              detail="acceleration"
              onEdit={noop}
            />
          </View>
        </KitCase>
        <KitCase label="RPE mode, week 1: tap to expand the load and the effort">
          <SetRow
            index={1}
            prescription={`${formatInteger(5)} reps · RPE 6 · __ lb`}
            detail="RPE 6-7"
            kind="rpe"
            targetRpe={6}
            loadLb={185}
            onEdit={noop}
          />
        </KitCase>
        <KitCase label="landing prompt: the last set of a height ladder">
          <SetRow
            index={4}
            prescription={`${formatInteger(3)} × 24 in box`}
            detail="last set of the ladder"
            promptsLanding
            onEdit={noop}
          />
        </KitCase>
        <KitCase label="disabled, while a clearance blocks the runner">
          <SetRow index={1} prescription={formatLoadedSet(5, 205)} disabled onEdit={noop} />
        </KitCase>
      </KitSection>

      <KitSection title="Notice" note="Rule-derived, computed from real numbers. No stripe, no icon.">
        <Notice text="Deload week (5 of 12). Sets and contacts cut by half. Loads held. Planned." />
        <Notice
          text="Soreness 8/10. Today one tier down: reps up, loads −10%, no depth jumps."
          detail="Originals stay on each row's second line. Change the answer to undo it."
          live
        />
        <Notice
          text="Showing saved copy from 6:12 AM."
          actionLabel="Retry"
          onAction={noop}
        />
      </KitSection>

      <KitSection
        title="ResultBlock"
        note="Paper by default with the header line in green. Committed only for a PR at or above the threshold."
      >
        <KitCase label="ordinary test day, on paper">
          <ResultBlock
            eyebrow="Jump test · Sat 18 Oct"
            value={formatHeightValueIn(inToMm(32.1))}
            unit="in"
            line="+0.4 (within test noise, PR updated)"
            instrument="OVR Jump · standing CMJ"
            footerLeft="Recovery this morning 71%"
            footerRight="Bodyweight 181 lb"
          />
        </KitCase>
        <KitCase label="the PR exception: the one loud moment in the system">
          <ResultBlock
            eyebrow="Jump test · Sat 25 Oct"
            value={formatHeightValueIn(inToMm(32.5))}
            unit="in"
            line="New PR · +1.2 over 27 Sep · goal 36.0 by 29 Nov"
            instrument="OVR Jump · standing CMJ"
            committed
            bleed={16}
            footerLeft="Recovery this morning 71%"
            footerRight="Bodyweight 181 lb"
          />
        </KitCase>
        <KitCase label="calibrating: no PR moment for the first three sessions">
          <ResultBlock
            eyebrow="Jump test · Sat 11 Oct"
            value={formatHeightValueIn(inToMm(31.9))}
            unit="in"
            line="calibrating (2 of 3)"
            instrument="OVR Jump · standing CMJ"
          />
        </KitCase>
      </KitSection>

      <KitSection title="RestBar and FooterLine" note="One number, the next load, a 44px stop.">
        <KitCase label="resting, with the next set named">
          <RestBar remainingS={180} nextLine="next: set 3 · 3 × 235 lb (+15 lb)" onStop={noop} />
        </KitCase>
        <KitCase label="every row logged: the finish link joins the bar">
          <RestBar
            remainingS={45}
            nextLine="every set logged"
            onStop={noop}
            trailing={<Button label="Finish session" variant="quiet" onPress={noop} />}
          />
        </KitCase>
        <KitCase label="footer line">
          <FooterLine left="Sets 2 of 22 · contacts 0 of 6" right="Test Sat · in 5 days" />
        </KitCase>
      </KitSection>
    </View>
  );
}
