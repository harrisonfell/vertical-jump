import { ScrollView, View } from 'react-native';
import { Text } from '../text';
import { space, useTheme } from '../theme';
import { Hairline } from './hairline';

export interface TableColumn<R> {
  readonly key: string;
  /** Header text in label style. */
  readonly header: string;
  /** Fixed width in px. Omit to share the remaining space. */
  readonly width?: number;
  /**
   * Right-aligned. Every cell already carries tabular figures, so this only
   * decides which edge the column hangs from.
   */
  readonly numeric?: boolean;
  readonly render: (row: R) => string;
}

export interface TableProps<R> {
  readonly columns: readonly TableColumn<R>[];
  readonly rows: readonly R[];
  readonly rowKey: (row: R, index: number) => string;
  /** Names the table for a screen reader: "Weeks", "Test ledger". */
  readonly caption?: string;
  /**
   * Total width the columns need. When it exceeds the screen the table scrolls
   * inside itself rather than making the page scroll sideways.
   */
  readonly minWidth?: number;
  readonly emptyText?: string;
  readonly testID?: string;
}

/**
 * The plain data table: a label-style header row, hairline rows, numbers right
 * with tabular figures. It is also the twin every chart carries, so the same
 * facts are reachable without reading a shape.
 *
 * Every cell names its colour token and asks for tabular figures, whatever the
 * column is. Two reasons, and both showed up on the Progress weeks table:
 * a cell that inherits its colour picks up the browser's link colour the
 * moment the row sits inside an anchor, so "7" and "4/4" came out blue and out
 * of the ink palette; and a text column that carries digits ("7", "4/4",
 * "All reps") needs the same figure widths as the number columns beside it or
 * the column stops lining up.
 */
export function Table<R>({
  columns,
  rows,
  rowKey,
  caption,
  minWidth,
  emptyText = 'Nothing logged yet.',
  testID,
}: TableProps<R>) {
  const { colors } = useTheme();

  const body = (
    <View style={{ minWidth }}>
      {/* Not accessibilityRole="header": react-native-web renders that as an
          <h1>, so every table on a screen would put "Date Height Instrument"
          into the heading outline a screen reader navigates by. */}
      <View
        accessibilityRole="none"
        style={{ flexDirection: 'row', gap: space.md, paddingBottom: space.xs }}
      >
        {columns.map((column) => (
          <Text
            key={column.key}
            variant="label"
            color="ink3"
            align={column.numeric === true ? 'right' : 'left'}
            numberOfLines={1}
            style={{
              color: colors.ink3,
              ...(column.width === undefined
                ? { flex: 1 }
                : { width: column.width, flexGrow: 0, flexShrink: 0 }),
            }}
          >
            {column.header}
          </Text>
        ))}
      </View>
      <Hairline strong />

      {rows.length === 0 ? (
        <Text variant="caption" color="ink3" style={{ paddingVertical: space.md }}>
          {emptyText}
        </Text>
      ) : (
        rows.map((row, index) => (
          <View key={rowKey(row, index)}>
            <View
              style={{
                flexDirection: 'row',
                gap: space.md,
                minHeight: 44,
                alignItems: 'center',
                backgroundColor: colors.paper,
              }}
            >
              {columns.map((column) => (
                <Text
                  key={column.key}
                  variant="caption"
                  color="ink"
                  numeric
                  align={column.numeric === true ? 'right' : 'left'}
                  style={{
                    // D-48: written into the cell's own style at render, not
                    // left to a rule injected later. A static export carries
                    // the markup before any runtime stylesheet exists, so a
                    // cell that inherits its colour is at the mercy of whatever
                    // the browser paints text inside a link with.
                    color: colors.ink,
                    ...(column.width === undefined
                      ? { flex: 1 }
                      : { width: column.width, flexGrow: 0, flexShrink: 0 }),
                  }}
                >
                  {column.render(row)}
                </Text>
              ))}
            </View>
            <Hairline />
          </View>
        ))
      )}
    </View>
  );

  return (
    <View testID={testID} accessibilityLabel={caption} style={{ gap: space.xs }}>
      {caption === undefined ? null : (
        <Text variant="label" color="ink2">
          {caption}
        </Text>
      )}
      {minWidth === undefined ? (
        body
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {body}
        </ScrollView>
      )}
    </View>
  );
}
