import { View } from 'react-native';
import type { analytics } from '@vert/engine';
import { Button, Glyph, Notice, Text, space, useTheme } from '@/ui';
// Straight at the two modules rather than at the Whoop barrel: the barrel also
// exports the Whoop screen, which imports Settings back, and Metro then warns
// about a require cycle whose uninitialised values are a real hazard.
import { DATA_BY_WHOOP, gateCriterionLine } from '../whoop/copy';
import { RULEBOOK_ALWAYS_ON, type ShadowEvaluation } from '../whoop/shadow';
import { RowDivider, SettingRow, SettingSection } from './row';

/**
 * "Whoop autoregulation": the gate, the shadow preview, and the toggle.
 *
 * The gate is a fact rather than a promise, so every criterion carries its own
 * live count and the toggle stays disabled, visibly, until all five are met.
 * The shadow line says what the modifier would have done today and that it did
 * not. The sentence about rule-book adjustments is always shown, because the
 * athlete has to know that soreness and pain are live whatever this toggle
 * says.
 */

export interface AutoregulationSectionProps {
  readonly gate: analytics.GateResult;
  readonly shadow: ShadowEvaluation;
  readonly enabled: boolean;
  readonly pausedReason: string | null;
  readonly onToggle: (next: boolean) => void;
  readonly busy?: boolean;
}

function CriterionRow({ criterion }: { readonly criterion: analytics.GateCriterion }) {
  const { colors } = useTheme();
  const line = gateCriterionLine(criterion);
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 32 }}
      accessibilityLabel={`${line}, ${criterion.met ? 'met' : 'not met yet'}`}
    >
      <Glyph
        name={criterion.met ? 'check' : 'minus'}
        size={16}
        color={criterion.met ? colors.green : colors.ink3}
      />
      <Text variant="body" color={criterion.met ? 'ink' : 'ink2'} style={{ flex: 1 }} numeric>
        {line}
      </Text>
    </View>
  );
}

export function AutoregulationSection({
  gate,
  shadow,
  enabled,
  pausedReason,
  onToggle,
  busy = false,
}: AutoregulationSectionProps) {
  return (
    <SettingSection
      title="Whoop autoregulation"
      note="Whoop can lower a session once your own data shows it should. Until then it runs in shadow: logged, shown, never applied."
      testID="settings-autoregulation"
    >
      <View style={{ paddingVertical: space.md, gap: space.xs }}>
        {gate.criteria.map((criterion) => (
          <CriterionRow key={criterion.id} criterion={criterion} />
        ))}
      </View>

      <RowDivider />

      <SettingRow
        label="Today in shadow"
        caption={`${shadow.line} ${DATA_BY_WHOOP}`}
        testID="settings-shadow-preview"
      />

      <RowDivider />

      {pausedReason === null ? null : <Notice text={pausedReason} />}

      <SettingRow
        label="Apply Whoop adjustments"
        value={enabled ? 'On' : 'Off'}
        caption={
          gate.eligible
            ? 'Downward only, explained on the session, reversible here.'
            : 'Available once every criterion above is met.'
        }
        testID="settings-autoregulation-toggle"
      >
        <View style={{ flexDirection: 'row', gap: space.sm, paddingTop: space.sm }}>
          <Button
            label={enabled ? 'Turn off' : 'Turn on'}
            variant={enabled ? 'secondary' : 'primary'}
            disabled={!gate.eligible || busy}
            loading={busy}
            onPress={() => onToggle(!enabled)}
            testID="settings-autoregulation-button"
          />
        </View>
      </SettingRow>

      <RowDivider />

      <SettingRow label="Always on" caption={RULEBOOK_ALWAYS_ON} testID="settings-rulebook-always" />
    </SettingSection>
  );
}
