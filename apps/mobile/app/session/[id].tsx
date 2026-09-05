import { useLocalSearchParams } from 'expo-router';
import { SessionScreen } from '@/features/session';

export default function Session() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SessionScreen sessionId={id} />;
}
