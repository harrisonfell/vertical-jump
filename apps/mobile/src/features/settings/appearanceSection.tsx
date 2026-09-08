import { View } from 'react-native';
import { ChipRow, space } from '@/ui';
// Deep imports on purpose: the app barrel re-exports the providers, and a
// Settings section reaching through it is how the last require cycle started.
import { useThemeOverride } from '@/app/theme';
import {
  SCHEME_CHOICES,
  SCHEME_CHOICE_LABEL,
  type SchemeChoice,
} from '@/app/themeChoice';
import { SettingSection } from './row';

/**
 * Appearance: the one preference that is about the room rather than the
 * training.
 *
 * Three answers, laid down as one row of chips, because "System" is a real
 * answer and a two-state switch cannot hold it: the phone follows the sunset
 * on its own unless the athlete says otherwise. The chosen chip is the kit's
 * ordinary selected chip, so the answer is a word before it is a colour.
 */

/** The caption under the heading, written from what is actually stored. */
export function appearanceCaption(choice: SchemeChoice): string {
  return choice === 'system'
    ? 'Following the phone. Paper by day, charcoal at night.'
    : `Pinned to ${SCHEME_CHOICE_LABEL[choice].toLowerCase()} on every device you open this on.`;
}

export function AppearanceSection() {
  const { choice, setOverride } = useThemeOverride();

  return (
    <SettingSection title="Appearance" note={appearanceCaption(choice)} testID="settings-appearance">
      <View style={{ paddingVertical: space.md }}>
        <ChipRow
          groupLabel="Theme"
          options={SCHEME_CHOICES.map((value) => ({
            value,
            label: SCHEME_CHOICE_LABEL[value],
          }))}
          value={choice}
          onChange={(value) => setOverride(value)}
          testID="settings-theme"
        />
      </View>
    </SettingSection>
  );
}
