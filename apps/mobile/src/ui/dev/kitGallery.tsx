import { View } from 'react-native';
import { Header } from '../primitives/header';
import { Screen } from '../primitives/screen';
import { Text } from '../text';
import { space } from '../theme';
import { KitControls } from './kitControls';
import { KitSession } from './kitSession';
import { KitSurfaces } from './kitSurfaces';

/**
 * The component gallery behind /dev/kit. Every component in every state, with
 * real copy and every number formatted by the engine, so a screenshot pass at
 * 390, 834, and 1280 in both schemes proves the kit rather than a mock of it.
 *
 * It is not in the tab bar and nothing links to it.
 */
export function KitGallery() {
  return (
    <Screen
      wide
      header={<Header title="UI kit" variant="headline" subtitle="Dev only · not in the tab bar" />}
    >
      <View style={{ gap: space.sm }}>
        <Text variant="body" color="ink2" style={{ maxWidth: 560 }}>
          Every state the screens can ask for. Light and dark follow the system setting; the copy
          and the numbers come from the brief and from the engine's formatters.
        </Text>
      </View>

      <KitControls />
      <KitSession />
      <KitSurfaces />
    </Screen>
  );
}
