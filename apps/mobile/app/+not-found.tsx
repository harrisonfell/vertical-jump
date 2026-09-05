import { Link } from 'expo-router';
import { View } from 'react-native';
import { Text } from '@/ui/text';
import { useTheme } from '@/ui/theme';

export default function NotFoundScreen() {
  const { colors, space } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.lg,
        padding: space.lg,
        backgroundColor: colors.paper,
      }}
    >
      <Text variant="headline">Nothing here</Text>
      <Link href="/" replace>
        <Text variant="body" color="green">
          Go to Today
        </Text>
      </Link>
    </View>
  );
}
