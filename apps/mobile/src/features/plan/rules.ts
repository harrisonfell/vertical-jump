import type { HouseRule, Ruleset } from '@vert/engine';

/**
 * The rules summary: the only place in the app a rule number appears.
 *
 * It renders from the versioned ruleset file, never from prose in a screen, so
 * the words the athlete reads and the numbers the engine applied cannot drift
 * apart. Each entry is the rule in plain words plus the rule-book number, or,
 * where the rule book says nothing, the plain fact that no rule-book rule
 * exists (brief section 05 "Plan").
 */

export interface RuleEntry {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  /** "+5 extensive contacts", when the change has a size. */
  readonly magnitude: string | null;
  /**
   * The parenthetical the entry shows: "house rule · rules 112, 117",
   * "reading · rule 91", "house rule, no rule-book rule exists". Null when
   * the title already says it.
   */
  readonly note: string | null;
  readonly kind: HouseRule['kind'];
  /** "house rule", "safety override", "reading": what kind of entry this is. */
  readonly kindLabel: string;
}

/** The applied group is not a `kind`: it draws from all three. */
export type RuleGroupKey = HouseRule['kind'] | 'applied';

export interface RuleGroup {
  readonly key: RuleGroupKey;
  readonly heading: string;
  readonly caption: string;
  readonly entries: RuleEntry[];
}

/** "rule 91" or "rules 52, 85". Null when the rule book names nothing. */
export function ruleNumbersNote(rules: readonly number[]): string | null {
  if (rules.length === 0) return null;
  const only = rules[0];
  if (rules.length === 1 && only !== undefined) return `rule ${only}`;
  return `rules ${rules.join(', ')}`;
}

const NO_RULE = 'house rule, no rule-book rule exists';

/**
 * The trailing note for one rule. Some titles already say the rule book is
 * silent ("Hip pain: house rule, no rule-book rule exists"); those keep the
 * sentence they were written with rather than saying it twice.
 */
export function ruleNote(rule: HouseRule): string | null {
  const numbers = ruleNumbersNote(rule.rules);
  if (numbers !== null) return numbers;
  return rule.title.toLowerCase().includes(NO_RULE) ? null : NO_RULE;
}

/** "No maximal jumps the day after a heavy squat session (rule 91)". */
export function ruleSummaryLine(rule: HouseRule): string {
  const note = ruleNote(rule);
  return note === null ? rule.title : `${rule.title} (${note})`;
}

/**
 * What kind of entry this is, in the athlete's words.
 *
 * The brief asks for house rules to be "labelled as such". The group heading
 * does that while the reader is inside a group, but the applied list below
 * mixes all three kinds, and a rule that carries rule-book numbers reads as a
 * rule-book rule unless its own line says otherwise. So every entry carries
 * the word, and `house.sc.*` (the sport's own rules, which all cite rule
 * numbers) says "house rule" beside the numbers it cites.
 */
const KIND_LABELS: Readonly<Record<HouseRule['kind'], string>> = {
  house: 'house rule',
  override: 'safety override',
  reading: 'reading',
};

export function ruleKindLabel(kind: HouseRule['kind']): string {
  return KIND_LABELS[kind];
}

/**
 * The whole parenthetical for one entry: what kind of rule it is and which
 * rule-book rules it touches. Null when the title already carries the words,
 * so "Hip pain: house rule, no rule-book rule exists" is never followed by a
 * second copy of the same sentence.
 */
export function ruleTag(rule: HouseRule): string | null {
  if (rule.title.toLowerCase().includes(NO_RULE)) return null;
  const label = ruleKindLabel(rule.kind);
  const numbers = ruleNumbersNote(rule.rules);
  return numbers === null ? `${label}, no rule-book rule exists` : `${label} · ${numbers}`;
}

export function toRuleEntry(rule: HouseRule): RuleEntry {
  return {
    id: rule.id,
    title: rule.title,
    text: rule.text,
    magnitude: rule.magnitude ?? null,
    note: ruleTag(rule),
    kind: rule.kind,
    kindLabel: ruleKindLabel(rule.kind),
  };
}

const GROUPS: readonly { kind: HouseRule['kind']; heading: string; caption: string }[] = [
  {
    kind: 'override',
    heading: 'Safety overrides',
    caption: 'Where the rule book is deliberately not followed, because safety comes first.',
  },
  {
    kind: 'house',
    heading: 'House rules',
    caption: 'Decisions this app makes where the rule book is silent.',
  },
  {
    kind: 'reading',
    heading: 'Readings',
    caption: 'How an ambiguous rule is read here, stated so you can check it.',
  },
];

/** The whole summary, grouped so safety reads first (Rule 0 order). */
export function ruleGroups(ruleset: Ruleset): RuleGroup[] {
  return GROUPS.map((group) => ({
    key: group.kind,
    heading: group.heading,
    caption: group.caption,
    entries: ruleset.houseRules.filter((rule) => rule.kind === group.kind).map(toRuleEntry),
  })).filter((group) => group.entries.length > 0);
}

/**
 * The rules this week actually applied, in ruleset order.
 *
 * `materializeWeek` writes `houseRuleIds` off the built week, so a rule that
 * changed nothing is not in the list. For a speed climber it is the
 * `house.sc.*` set: the sport's requirements, the upper power day, the grip,
 * the finger spacing and ceiling, the knee-alignment work, the weaker side,
 * the box squat, the readiness gate and the asymmetry stream. Showing them
 * first is the difference between a document and an answer to "why is my week
 * shaped like this".
 *
 * @returns the group, or null when the week claimed no rule.
 */
export function appliedRuleGroup(
  ruleset: Ruleset,
  appliedIds: readonly string[],
): RuleGroup | null {
  const wanted = new Set(appliedIds);
  const entries = ruleset.houseRules
    .filter((rule) => wanted.has(rule.id))
    .map(toRuleEntry);
  if (entries.length === 0) return null;
  return {
    key: 'applied',
    heading: 'Applied this week',
    caption: 'The rules that shaped this week, read off the week itself.',
    entries,
  };
}

/** "44 rules · ruleset 1.0.0", the line that stays visible while collapsed. */
export function rulesSummaryCount(ruleset: Ruleset): string {
  const count = ruleset.houseRules.length;
  return `${count} rules · ruleset ${ruleset.version}`;
}
