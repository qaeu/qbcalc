/**
 * Table-rule presets for the settings UI.
 *
 * Kept out of `ev/` for the same reason `countingSystems.ts` is: the engine
 * consumes a `RuleSet` and has no notion of the jurisdictions those rule sets
 * are named after.
 *
 * Unlike a counting system, a preset is not stored alongside the settings --
 * the rules themselves say which preset is selected, so `presetForRules`
 * recovers it and nothing has to be kept in sync. 'Custom' is what that lookup
 * returns when the rules match no preset, rather than a choice of its own.
 */

import { DEFAULT_RULE_SET, type RuleSet } from './ev/rules';

export type RulePresetId = 'uk' | 'europe' | 'vegas' | 'custom';

export interface RulePreset {
	id: RulePresetId;
	label: string;
	/** `null` for 'custom', whose rules are whatever the user set. */
	rules: RuleSet | null;
}

/**
 * The UK game is the app's default rule set: a no-hole-card table where split
 * aces may be drawn to normally and no surrender is offered.
 *
 * The other presets are written as the deltas from it, so what a jurisdiction
 * changes is what the entry shows. Deck count and penetration stay put across
 * all three -- they vary house by house rather than by jurisdiction, so a
 * preset switch has no business moving them.
 */
export const RULE_PRESETS: readonly RulePreset[] = [
	{ id: 'uk', label: 'UK', rules: DEFAULT_RULE_SET },
	{
		// Continental Europe deals the same no-hole-card game, but split aces
		// take exactly one card as they do nearly everywhere outside the UK.
		id: 'europe',
		label: 'Europe',
		rules: { ...DEFAULT_RULE_SET, hitSplitAces: false },
	},
	{
		// Vegas deals a hole card and peeks it, which is what makes late
		// surrender available; six-deck shoes there hit soft 17.
		id: 'vegas',
		label: 'Vegas',
		rules: {
			...DEFAULT_RULE_SET,
			dealerHitsSoft17: true,
			dealerPeek: true,
			surrender: 'late',
			hitSplitAces: false,
		},
	},
	{ id: 'custom', label: 'Custom', rules: null },
];

/**
 * Whether two rule sets describe the same game. Every field is a primitive, so
 * a field-wise comparison is enough -- extend it alongside `RuleSet`.
 */
export function ruleSetsEqual(a: RuleSet, b: RuleSet): boolean {
	return (
		a.decks === b.decks
		&& a.dealerHitsSoft17 === b.dealerHitsSoft17
		&& a.penetrationPercent === b.penetrationPercent
		&& a.blackjackPayout === b.blackjackPayout
		&& a.surrender === b.surrender
		&& a.splitLimit === b.splitLimit
		&& a.doubleAfterSplit === b.doubleAfterSplit
		&& a.resplitAces === b.resplitAces
		&& a.hitSplitAces === b.hitSplitAces
		&& a.dealerPeek === b.dealerPeek
		&& a.insurance === b.insurance
	);
}

/** The preset's rules, or `null` if the preset has no fixed rules. */
export function rulesForPreset(id: RulePresetId): RuleSet | null {
	return RULE_PRESETS.find((preset) => preset.id === id)?.rules ?? null;
}

/** The preset these rules are, or 'custom' if they are none of them. */
export function presetForRules(rules: RuleSet): RulePresetId {
	const match = RULE_PRESETS.find(
		(preset) => preset.rules !== null && ruleSetsEqual(preset.rules, rules)
	);
	return match?.id ?? 'custom';
}
