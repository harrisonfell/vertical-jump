import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ariaState } from '../a11y';
import { Hairline } from '../primitives/hairline';
import { Text } from '../text';
import { useTheme } from '../theme';

export interface ChartTableColumn {
  readonly key: string;
  readonly header: string;
  /** Numeric columns right-align, as every numeric column in the app does. */
  readonly numeric?: boolean;
  readonly width?: number;
}

export interface ChartTableProps {
  readonly columns: readonly ChartTableColumn[];
  /** One record per row, keyed by column key. Values are already formatted. */
  readonly rows: readonly Readonly<Record<string, string>>[];
  /** The disclosure label, e.g. "Show the test table". */
  readonly label: string;
  /** Start open. Off by default: the chart is the first reading. */
  readonly initiallyOpen?: boolean;
}

/**
 * The table twin every chart carries.
 *
 * A local minimum: `src/ui/primitives` has no shared Table yet. When the UI
 * agent lands one, this collapses onto it and the props here stay the same.
 */
export function ChartTable({ columns, rows, label, initiallyOpen = false }: ChartTableProps) {
  const { colors, space } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <View style={{ paddingTop: space.sm }}>
      <Pressable
        focusable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        {...ariaState({ expanded: open })}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => ({
          minHeight: 44,
          justifyContent: 'center',
          backgroundColor: pressed ? colors.paper3 : 'transparent',
        })}
      >
        <Text variant="caption" color="ink2">
          {open ? `Hide ${label}` : `Show ${label}`}
        </Text>
      </Pressable>
      {open ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <Hairline />
            <View style={{ flexDirection: 'row', paddingVertical: space.xs }}>
              {columns.map((column) => (
                <Cell key={column.key} column={column} header>
                  {column.header}
                </Cell>
              ))}
            </View>
            <Hairline />
            {rows.map((row, index) => (
              <View key={`${row[columns[0]?.key ?? 'k'] ?? index}-${index}`}>
                <View style={{ flexDirection: 'row', paddingVertical: space.xs }}>
                  {columns.map((column) => (
                    <Cell key={column.key} column={column}>
                      {row[column.key] ?? ''}
                    </Cell>
                  ))}
                </View>
                <Hairline />
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

function Cell({
  column,
  header = false,
  children,
}: {
  readonly column: ChartTableColumn;
  readonly header?: boolean;
  readonly children: string;
}) {
  const { space } = useTheme();
  return (
    <View
      style={{
        width: column.width ?? (column.numeric === true ? 76 : 116),
        paddingRight: space.sm,
        alignItems: column.numeric === true ? 'flex-end' : 'flex-start',
      }}
    >
      <Text
        variant={header ? 'label' : 'caption'}
        color={header ? 'ink3' : 'ink'}
        numeric
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
}
