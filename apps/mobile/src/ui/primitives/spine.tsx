import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Glyph, type GlyphName } from '../glyphs';
import { Text } from '../text';
import { space, useTheme } from '../theme';

/**
 * The session's spine: one hairline running down the left of the screen with a
 * node on it for every block the athlete moves through.
 *
 * A session is a sequence, and a list of headings does not say so. The spine
 * does, with the kit's own hairline and nothing else: no rail, no card, no
 * shadow, no photograph on the node. A node is a leading number or a glyph the
 * registry already draws, and the accent lands on exactly one of them, the one
 * the athlete is on.
 */

/** The width of the spine column. The rule runs down its centre. */
export const SPINE_WIDTH = 28;
/**
 * The gap between two nodes. The rule is drawn across it as well as down each
 * row, or the spine reads as a column of dashes rather than as one line.
 */
export const SPINE_GAP = space.sm;
/** The node mark's box. 20px is the glyph grid. */
const NODE = 20;
/**
 * How far the node sits below the top of its row, so the mark lines up with
 * the first line of the block's heading rather than with the gap above it.
 */
const NODE_OFFSET = space.md;

export type SpineNodeState = 'done' | 'current' | 'upcoming';

/** What a state is called, so the mark is never colour alone. */
export const SPINE_STATE_WORD: Readonly<Record<SpineNodeState, string>> = {
  done: 'done',
  current: 'current',
  upcoming: 'to come',
};

export interface SpineNodeProps {
  /** A leading number: "1", "2", "3". Ignored when a glyph is given. */
  readonly index?: string;
  /** A registry glyph for a block that is not a numbered exercise. */
  readonly glyph?: GlyphName;
  readonly state?: SpineNodeState;
  /** The first node: the rule starts at the mark rather than above it. */
  readonly first?: boolean;
  /** The last node: the rule stops at the mark rather than running on. */
  readonly last?: boolean;
  readonly children: ReactNode;
  readonly testID?: string;
}

/**
 * One node and the block beside it.
 *
 * A finished node takes the check glyph, the current one takes the accent, and
 * everything still to come stays in secondary ink. The state is spoken as a
 * word as well, so the green is never carrying the meaning by itself.
 */
export function SpineNode({
  index,
  glyph,
  state = 'upcoming',
  first = false,
  last = false,
  children,
  testID,
}: SpineNodeProps) {
  const { colors } = useTheme();

  const tint =
    state === 'current' ? colors.green : state === 'done' ? colors.ink3 : colors.ink2;

  // The rule is drawn behind the mark and clipped by the mark's own paper
  // backing, which is what makes the node read as sitting on the line.
  const railTop = first ? NODE_OFFSET + NODE / 2 : 0;
  const rail = last
    ? { top: railTop, height: Math.max(0, NODE_OFFSET + NODE / 2 - railTop) }
    : { top: railTop, bottom: -SPINE_GAP };

  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: space.md }}>
      <View style={{ width: SPINE_WIDTH, alignItems: 'center' }}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={{ position: 'absolute', width: 1, backgroundColor: colors.rule, ...rail }}
        />
        <View
          accessible
          accessibilityLabel={SPINE_STATE_WORD[state]}
          style={{
            marginTop: NODE_OFFSET,
            width: NODE,
            height: NODE,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.paper,
          }}
        >
          {state === 'done' ? (
            <Glyph name="check" size={14} color={tint} />
          ) : glyph !== undefined ? (
            <Glyph name={glyph} size={16} color={tint} />
          ) : (
            <Text
              variant="label"
              color={state === 'current' ? 'green' : 'ink2'}
              numeric
            >
              {index ?? ''}
            </Text>
          )}
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

export interface SpineProps {
  readonly children: ReactNode;
  readonly testID?: string;
}

/** The column the nodes stack in. It owns the spacing, nothing else. */
export function Spine({ children, testID }: SpineProps) {
  return (
    <View testID={testID} style={{ gap: SPINE_GAP }}>
      {children}
    </View>
  );
}
