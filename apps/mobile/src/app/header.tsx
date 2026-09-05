import { Platform, Pressable, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Glyph, Header, Text, space, useTheme } from '@/ui';
import { href, routeHref } from './routes';
import { fallbackFor, isTabRoute, splitHeaderTitle } from './headerTitle';

/**
 * The slim sticky header: the way back on the left, the sentence that says
 * where the athlete is in the middle, Settings on the right.
 *
 * Settings is the one thing that lives off the daily path, so it is a 44px
 * target in the corner. Neither control is a lone glyph: the kit's rule is the
 * word beside the picture, and the back control in particular is the only exit
 * from eight routes that sit outside the tab bar.
 */

export interface AppHeaderProps {
  /** "Week 7 of 12 · Power block · Power + Speed" or "Progress". */
  readonly title: string;
  readonly subtitle?: string;
  readonly trailingText?: string;
  readonly variant?: 'label' | 'headline';
  /** Drop the settings control on screens that are already a settings page. */
  readonly showSettings?: boolean;
  /**
   * Force the back control on or off. Left unset, it appears on every route
   * that is not one of the three tabs, which is exactly the set of screens the
   * tab bar cannot bring the athlete home from.
   */
  readonly showBack?: boolean;
  readonly testID?: string;
}

interface ControlProps {
  readonly label: string;
  readonly glyph: 'chevron' | 'settings';
  readonly onPress: () => void;
  readonly testID: string;
  /** The word is visible beside the glyph unless it would crowd the line. */
  readonly wordVisible?: boolean;
}

function HeaderControl({ label, glyph, onPress, testID, wordVisible = false }: ControlProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 44,
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.xxs,
        paddingHorizontal: wordVisible ? space.xs : 0,
        backgroundColor: pressed ? colors.paper3 : 'transparent',
      })}
    >
      {glyph === 'chevron' ? (
        // The kit ships one chevron, pointing right. Back turns it around.
        <View style={{ transform: [{ rotate: '180deg' }] }}>
          <Glyph name="chevron" size={20} color={colors.ink2} />
        </View>
      ) : (
        <Glyph name={glyph} size={20} color={colors.ink2} />
      )}
      {wordVisible ? (
        <Text variant="label" color="ink2">
          {label}
        </Text>
      ) : Platform.OS === 'web' ? (
        <View style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}>
          <Text variant="caption">{label}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function BackControl() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <HeaderControl
      label="Back"
      glyph="chevron"
      testID="header-back"
      wordVisible
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace(href(fallbackFor(pathname)));
      }}
    />
  );
}

function SettingsControl() {
  const router = useRouter();
  return (
    <HeaderControl
      label="Settings"
      glyph="settings"
      testID="header-settings"
      onPress={() => router.push(routeHref('settings'))}
    />
  );
}

export function AppHeader({
  title,
  subtitle,
  trailingText,
  variant = 'headline',
  showSettings = true,
  showBack,
  testID,
}: AppHeaderProps) {
  const pathname = usePathname();
  const back = showBack ?? !isTabRoute(pathname);
  const { head, tail } =
    variant === 'headline' ? splitHeaderTitle(title, subtitle) : { head: title, tail: subtitle };

  return (
    <Header
      title={head}
      {...(tail === undefined ? null : { subtitle: tail })}
      {...(trailingText === undefined ? null : { trailingText })}
      variant={variant}
      {...(testID === undefined ? null : { testID })}
      {...(back ? { back: <BackControl /> } : null)}
      {...(showSettings ? { right: <SettingsControl /> } : null)}
    />
  );
}
