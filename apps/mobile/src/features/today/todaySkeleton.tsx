import { View } from 'react-native';
import { Header, Screen, Skeleton, space } from '@/ui';

/**
 * Today while the database opens.
 *
 * The blocks are the real row heights, so when the session lands nothing moves
 * and the thumb is already over the first set. The kit's skeleton holds still
 * under reduced motion, so there is no separate path here.
 */
export function TodaySkeleton() {
  return (
    <Screen header={<Header title="Today" />} testID="today-skeleton">
      <Skeleton skeletonFor="strip" />
      <Skeleton skeletonFor="line" count={2} />
      <View style={{ gap: space.md }}>
        <Skeleton skeletonFor="header" />
        <Skeleton skeletonFor="setRow" count={4} />
        <Skeleton skeletonFor="header" />
        <Skeleton skeletonFor="setRow" count={3} />
      </View>
    </Screen>
  );
}
