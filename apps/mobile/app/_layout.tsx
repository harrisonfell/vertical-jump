import { Stack } from 'expo-router';
import { AppProviders, useAppFonts } from '@/app';

export default function RootLayout() {
  const ready = useAppFonts();
  if (!ready) return null;

  return (
    <AppProviders>
      <Stack screenOptions={{ headerShown: false }} />
    </AppProviders>
  );
}
