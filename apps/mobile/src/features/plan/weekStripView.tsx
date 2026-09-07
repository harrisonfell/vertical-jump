import { Pressable, View, useWindowDimensions } from 'react-native';
import {
  FocusRing,
  Glyph,
  Hairline,
  Text,
  breakpoint,
  space,
  useFocusVisible,
  useTheme,
} from '@/ui';
import { formatDayDate, weekdayShort } from './dates';
import type { Strip, StripCell, StripRow } from './weekStrip';

/**
 * The week strip.
 *
 * Every week opens with a full-width header ("Week 7 · Deload"), and the days
 * below it compose rather than shrink. Seven columns of words do not fit a
 * phone at any size in this type scale, so a phone gets the week as rows, one
 * training day each, with the rest days named on one line beneath; from the
 * tablet breakpoint up the same content lays out as the seven-column grid the
 * calendar wants. Nothing scrolls sideways and no word is ever cut: a day the
 * athlete cannot read is a day they will not plan around.
 *
 * Every cell carries a day-type glyph and a word, and a state glyph and a
 * word, so nothing here is legible by colour alone. Tapping a day opens that
 * session. Days in a week that has not been built yet carry the day type but
 * no link, because there is nothing to open.
 */

export interface WeekStripProps {
  readonly strip: Strip;
  readonly onOpen: (sessionId: string) => void;
  readonly testID?: string;
}

const CELL_HEIGHT = 84;
const GAP = space.xs;
/** A grid column, and the header above it: both flex so seven always fit. */
const COLUMN = { flex: 1, minWidth: 0 } as const;

/** One day in the grid: glyphs on top, then the day type, then the state. */
function GridCellBody({ cell }: { readonly cell: StripCell }) {
  const { colors } = useTheme();
  const muted = cell.state === 'rest';

  return (
    <View style={{ flex: 1, gap: 2, paddingVertical: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, height: 16 }}>
        <Glyph name={cell.dayGlyph} size={14} color={muted ? colors.ink3 : colors.ink2} />
        {cell.isTest ? <Glyph name="test" size={14} color={colors.ink2} /> : null}
      </View>
      <Text variant="caption" color={muted ? 'ink3' : 'ink'} numberOfLines={2}>
        {cell.dayTypeShort}
      </Text>
      {muted ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.xs }}>
          {cell.stateGlyph === null ? null : (
            <Glyph name={cell.stateGlyph} size={12} color={colors.ink3} />
          )}
          <Text variant="caption" color="ink3" numberOfLines={2} style={{ flex: 1 }}>
            {cell.stateLabel}
          </Text>
        </View>
      )}
    </View>
  );
}

/** One day in the phone list: the whole sentence on one 44px row. */
function ListCellBody({ cell }: { readonly cell: StripCell }) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        minHeight: 44,
        paddingVertical: space.sm,
      }}
    >
      <Glyph name={cell.dayGlyph} size={16} color={colors.ink2} />
      <Text variant="caption" color="ink2" numeric style={{ width: 78 }}>
        {formatDayDate(cell.date)}
      </Text>
      <Text variant="body" color="ink" numberOfLines={1} style={{ flex: 1 }}>
        {cell.dayTypeShort}
      </Text>
      {cell.isTest ? <Glyph name="test" size={14} color={colors.ink2} /> : null}
      {cell.stateGlyph === null ? null : (
        <Glyph name={cell.stateGlyph} size={12} color={colors.ink3} />
      )}
      <Text variant="caption" color="ink2">
        {cell.stateLabel}
      </Text>
    </View>
  );
}

function Day({
  cell,
  layout,
  onOpen,
}: {
  readonly cell: StripCell;
  readonly layout: 'grid' | 'list';
  readonly onOpen: (id: string) => void;
}) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  const sessionId = cell.sessionId;
  const grid = layout === 'grid';

  const frame = grid
    ? {
        ...COLUMN,
        minHeight: CELL_HEIGHT,
        backgroundColor: cell.isToday ? colors.paper2 : 'transparent',
      }
    : { backgroundColor: cell.isToday ? colors.paper2 : 'transparent' };

  const body = grid ? <GridCellBody cell={cell} /> : <ListCellBody cell={cell} />;
  const marker = cell.isToday ? (
    <View style={{ height: 2, backgroundColor: colors.green }} />
  ) : null;

  if (sessionId === null) {
    return (
      <View accessibilityLabel={cell.label} style={frame}>
        {body}
        {marker}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cell.label}
      onPress={() => onOpen(sessionId)}
      onFocus={focusProps.onFocus}
      onBlur={focusProps.onBlur}
      style={({ pressed }) => ({
        ...frame,
        backgroundColor: pressed ? colors.paper3 : frame.backgroundColor,
      })}
    >
      <FocusRing visible={focusVisible} inset={2} />
      {body}
      {marker}
    </Pressable>
  );
}

function WeekHeader({ row }: { readonly row: StripRow }) {
  const { colors } = useTheme();
  const kindLabel =
    row.kind === 'load'
      ? null
      : row.kind === 'deload'
        ? 'Deload'
        : row.kind === 'taper'
          ? 'Taper'
          : 'Peak';

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: space.sm,
        paddingTop: space.sm,
        paddingBottom: space.xs,
      }}
    >
      <Text variant="label" color={row.isCurrent ? 'ink' : 'ink2'}>
        {row.weekLabel}
      </Text>
      {kindLabel === null ? null : (
        <Text variant="caption" color="ink3">
          {kindLabel}
        </Text>
      )}
      {row.repeatLabel === null ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Glyph name="state-repeat" size={12} color={colors.ink3} />
          <Text variant="caption" color="ink3">
            {row.repeatLabel}
          </Text>
        </View>
      )}
      {row.projectedLabel === null ? null : (
        <Text variant="caption" color="ink3">
          {row.projectedLabel}
        </Text>
      )}
    </View>
  );
}

/** "Rest: Wed, Fri, Sun" - the gaps, named, without seven more rows. */
function restLine(cells: readonly StripCell[]): string | null {
  const days = cells
    .filter((cell) => cell.state === 'rest')
    .map((cell) => weekdayShort(cell.date));
  if (days.length === 0) return null;
  return `Rest: ${days.join(', ')}`;
}

function Row({
  row,
  layout,
  onOpen,
}: {
  readonly row: StripRow;
  readonly layout: 'grid' | 'list';
  readonly onOpen: (id: string) => void;
}) {
  const { colors } = useTheme();
  const ground = row.isCurrent ? colors.paper2 : 'transparent';

  if (layout === 'grid') {
    return (
      <View style={{ backgroundColor: ground }}>
        <WeekHeader row={row} />
        <View style={{ flexDirection: 'row', gap: GAP }}>
          {row.cells.map((cell) => (
            <Day key={cell.key} cell={cell} layout="grid" onOpen={onOpen} />
          ))}
        </View>
        <Hairline />
      </View>
    );
  }

  const training = row.cells.filter((cell) => cell.state !== 'rest');
  const rest = restLine(row.cells);

  return (
    <View style={{ backgroundColor: ground }}>
      <WeekHeader row={row} />
      <Hairline />
      {training.map((cell) => (
        <View key={cell.key}>
          <Day cell={cell} layout="list" onOpen={onOpen} />
          <Hairline />
        </View>
      ))}
      {rest === null ? null : (
        <Text variant="caption" color="ink3" numeric style={{ paddingVertical: space.sm }}>
          {rest}
        </Text>
      )}
    </View>
  );
}

export function WeekStrip({ strip, onOpen, testID }: WeekStripProps) {
  const { width } = useWindowDimensions();
  const layout = width >= breakpoint.tablet ? 'grid' : 'list';

  if (strip.rows.length === 0) return null;

  return (
    <View testID={testID}>
      {layout === 'grid' ? (
        <>
          <View style={{ flexDirection: 'row', gap: GAP, paddingBottom: space.xs }}>
            {strip.columns.map((column) => (
              <Text key={column.key} variant="label" color="ink3" numberOfLines={1} style={COLUMN}>
                {column.label}
              </Text>
            ))}
          </View>
          <Hairline strong />
        </>
      ) : null}
      {strip.rows.map((row) => (
        <Row key={row.w} row={row} layout={layout} onOpen={onOpen} />
      ))}
    </View>
  );
}
