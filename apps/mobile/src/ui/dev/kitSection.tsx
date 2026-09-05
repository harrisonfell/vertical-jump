import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Hairline } from '../primitives/hairline';
import { Text } from '../text';
import { space } from '../theme';

export interface KitSectionProps {
  readonly title: string;
  /** What the section is for, in one line. */
  readonly note?: string;
  readonly children: ReactNode;
}

/** One headed block of the gallery. */
export function KitSection({ title, note, children }: KitSectionProps) {
  return (
    <View style={{ gap: space.md, paddingTop: space.xl }}>
      <Text variant="headline" accessibilityRole="header">
        {title}
      </Text>
      {note === undefined ? null : (
        <Text variant="caption" color="ink3">
          {note}
        </Text>
      )}
      <Hairline strong />
      <View style={{ gap: space.lg }}>{children}</View>
    </View>
  );
}

export interface KitCaseProps {
  /** Names the state being shown: "pressed", "disabled", "week 1 RPE mode". */
  readonly label: string;
  readonly children: ReactNode;
}

/** One labelled state inside a section. */
export function KitCase({ label, children }: KitCaseProps) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" color="ink3">
        {label}
      </Text>
      {children}
    </View>
  );
}
