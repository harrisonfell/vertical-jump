import { View } from 'react-native';
import type { Ruleset } from '@vert/engine';
import { Disclosure, Hairline, Text, space } from '@/ui';
import { appliedRuleGroup, ruleGroups, rulesSummaryCount, type RuleEntry } from './rules';

/**
 * The rules summary. The one place in the app a rule number appears.
 *
 * Fifty-odd rules is a document, not a list, so it opens in groups. The rules
 * this week actually applied come first, because that is the question the
 * screen is being asked; then safety, in Rule 0 order: what the app refuses to
 * follow, what it decided where the rule book is silent, and how it reads the
 * rules that are ambiguous. Every entry says which kind it is, so a house rule
 * that cites rule-book numbers is never mistaken for a rule-book rule.
 */

export interface RulesSummaryProps {
  readonly ruleset: Ruleset;
  /**
   * The `houseRuleIds` the current week was built with. They open first, so
   * the sport's own rules are an answer rather than a search.
   */
  readonly appliedIds?: readonly string[];
  readonly testID?: string;
}

function Entry({ entry }: { readonly entry: RuleEntry }) {
  return (
    <View style={{ paddingVertical: space.sm, gap: 2 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: space.xs }}>
        <Text variant="body" color="ink" style={{ maxWidth: 560 }}>
          {entry.title}
        </Text>
        {entry.note === null ? null : (
          <Text variant="caption" color="ink3" numeric>
            ({entry.note})
          </Text>
        )}
      </View>
      <Text variant="caption" color="ink2" style={{ maxWidth: 560 }}>
        {entry.text}
      </Text>
      {entry.magnitude === null ? null : (
        <Text variant="caption" color="ink3" numeric>
          {entry.magnitude}
        </Text>
      )}
    </View>
  );
}

export function RulesSummary({ ruleset, appliedIds = [], testID }: RulesSummaryProps) {
  const applied = appliedRuleGroup(ruleset, appliedIds);
  const groups = applied === null ? ruleGroups(ruleset) : [applied, ...ruleGroups(ruleset)];

  return (
    <Disclosure title="Rules summary" summary={rulesSummaryCount(ruleset)} testID={testID}>
      {groups.map((group) => (
        <Disclosure
          key={group.key}
          title={group.heading}
          summary={`${group.entries.length}`}
          defaultOpen={group.key === 'applied'}
        >
          <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
            {group.caption}
          </Text>
          {group.entries.map((entry) => (
            <View key={entry.id}>
              <Hairline />
              <Entry entry={entry} />
            </View>
          ))}
        </Disclosure>
      ))}
    </Disclosure>
  );
}
