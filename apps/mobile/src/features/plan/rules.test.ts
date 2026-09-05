import { describe, expect, it } from 'vitest';
import { loadRuleset } from '@vert/engine';
import type { HouseRule } from '@vert/engine';
import {
  appliedRuleGroup,
  ruleGroups,
  ruleKindLabel,
  ruleNote,
  ruleNumbersNote,
  ruleSummaryLine,
  ruleTag,
  rulesSummaryCount,
  toRuleEntry,
} from './rules';

const ruleset = loadRuleset();

function find(id: string): HouseRule {
  const rule = ruleset.houseRules.find((entry) => entry.id === id);
  if (rule === undefined) throw new Error(`no rule ${id} in the ruleset`);
  return rule;
}

describe('ruleNumbersNote', () => {
  it('names one rule in the singular', () => {
    expect(ruleNumbersNote([91])).toBe('rule 91');
  });

  it('lists several', () => {
    expect(ruleNumbersNote([52, 85])).toBe('rules 52, 85');
  });

  it('is null when the rule book names nothing', () => {
    expect(ruleNumbersNote([])).toBeNull();
  });
});

describe('ruleNote', () => {
  it('carries the rule-book number when there is one', () => {
    expect(ruleNote(find('house.r89_trade'))).toBe('rule 89');
  });

  it('says a house rule stands alone when the rule book is silent', () => {
    expect(ruleNote(find('house.pr_threshold'))).toBe('house rule, no rule-book rule exists');
  });

  it('does not repeat a title that already says it', () => {
    expect(find('house.pain_hip').title).toContain('no rule-book rule exists');
    expect(ruleNote(find('house.pain_hip'))).toBeNull();
  });
});

describe('ruleSummaryLine', () => {
  it('writes the shape brief section 05 quotes', () => {
    expect(ruleSummaryLine(find('house.r89_trade'))).toBe(
      'More intensity buys less volume (rule 89)',
    );
    expect(ruleSummaryLine(find('house.pain_hip'))).toBe(
      'Hip pain: house rule, no rule-book rule exists',
    );
  });
});

describe('ruleGroups', () => {
  const groups = ruleGroups(ruleset);

  it('puts safety first, the way Rule 0 orders the rule book', () => {
    expect(groups.map((group) => group.key)).toEqual(['override', 'house', 'reading']);
  });

  it('renders every rule in the file exactly once', () => {
    const ids = groups.flatMap((group) => group.entries.map((entry) => entry.id));
    expect(ids).toHaveLength(ruleset.houseRules.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never leaves an entry without plain words', () => {
    for (const group of groups) {
      for (const entry of group.entries) {
        expect(entry.title.length).toBeGreaterThan(0);
        expect(entry.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps rule numbers out of the plain-words text', () => {
    for (const group of groups) {
      for (const entry of group.entries) {
        expect(entry.text).not.toMatch(/\brule \d+\b/i);
      }
    }
  });
});

describe('rulesSummaryCount', () => {
  it('names the count and the ruleset version', () => {
    expect(rulesSummaryCount(ruleset)).toBe(
      `${ruleset.houseRules.length} rules · ruleset ${ruleset.version}`,
    );
  });
});

/**
 * The sport's own rules. Every one of them cites rule-book numbers, so without
 * the words "house rule" beside those numbers they would read as rule-book
 * rules the athlete could look up (brief section 05: house rules are labelled
 * as such).
 */
describe('ruleKindLabel and ruleTag', () => {
  it('names each kind in the athletes own words', () => {
    expect(ruleKindLabel('house')).toBe('house rule');
    expect(ruleKindLabel('override')).toBe('safety override');
    expect(ruleKindLabel('reading')).toBe('reading');
  });

  it('labels a house rule that cites rule-book numbers', () => {
    expect(ruleTag(find('house.sc.sport_requirements'))).toBe(
      'house rule · rules 38, 102, 103, 104, 113',
    );
    expect(ruleTag(find('house.sc.hard_finger_spacing'))).toBe('house rule · rules 90, 91, 93');
  });

  it('shows the rewritten sport requirement, sprints included and no conditioning', () => {
    // The summary renders from the ruleset file, so this is what the athlete
    // actually reads under House rules after the sprint house rule was lifted.
    const entry = toRuleEntry(find('house.sc.sport_requirements'));
    expect(entry.title).toBe('Speed climbing needs a jump day and an upper power day');
    expect(entry.text).toContain('short acceleration sprints, 10 to 30 m');
    expect(entry.text).toContain('No conditioning block is added');
    expect(entry.text).toContain('Change-of-direction cutting is not part of this sport');
    expect(entry.text).not.toContain('no sprints');
    expect(entry.magnitude).toContain('10 to 30 m sprints on Power days');
  });

  it('labels a house rule the rule book says nothing about', () => {
    expect(ruleTag(find('house.sc.asymmetry_tracking'))).toBe(
      'house rule, no rule-book rule exists',
    );
  });

  it('labels a safety override and a reading', () => {
    expect(ruleTag(find('override.no_1rm_test_week'))).toBe('safety override · rule 154');
    expect(ruleTag(find('read.next_training_day'))).toBe('reading · rules 24, 90, 91');
  });

  it('says nothing when the title already carries the words', () => {
    expect(ruleTag(find('house.pain_hip'))).toBeNull();
  });
});

describe("the sport's house rules", () => {
  const sportRules = ruleset.houseRules.filter((rule) => rule.id.startsWith('house.sc.'));

  it('ships every one of them as a house rule, in plain words', () => {
    expect(sportRules.length).toBeGreaterThanOrEqual(12);
    for (const rule of sportRules) {
      const entry = toRuleEntry(rule);
      expect(entry.kind).toBe('house');
      expect(entry.kindLabel).toBe('house rule');
      expect(entry.note).toContain('house rule');
      expect(entry.text.length).toBeGreaterThan(0);
      expect(entry.text).not.toMatch(/rule \d+/i);
    }
  });

  it('lists them under House rules, once each', () => {
    const house = ruleGroups(ruleset).find((group) => group.key === 'house');
    const ids = house?.entries.map((entry) => entry.id) ?? [];
    for (const rule of sportRules) expect(ids).toContain(rule.id);
  });
});

describe('appliedRuleGroup', () => {
  const applied = appliedRuleGroup(ruleset, [
    'house.sc.readiness_gate',
    'house.sc.sport_requirements',
    'house.sc.not_a_rule',
  ]);

  it('opens with the rules the week actually applied', () => {
    expect(applied?.key).toBe('applied');
    expect(applied?.heading).toBe('Applied this week');
  });

  it('keeps ruleset order and drops an id the ruleset does not ship', () => {
    expect(applied?.entries.map((entry) => entry.id)).toEqual([
      'house.sc.sport_requirements',
      'house.sc.readiness_gate',
    ]);
  });

  it('labels every entry, because the group mixes the three kinds', () => {
    for (const entry of applied?.entries ?? []) expect(entry.kindLabel).toBe('house rule');
  });

  it('is absent for a week that claimed no rule', () => {
    expect(appliedRuleGroup(ruleset, [])).toBeNull();
  });
});
