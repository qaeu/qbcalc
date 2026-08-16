import { describe, expect, it } from 'vitest';

import { DEFAULT_RULE_SET, type RuleSet } from '#utils/ev/rules';
import {
	presetForRules,
	RULE_PRESETS,
	rulesForPreset,
	ruleSetsEqual,
} from '#utils/rulePresets';

describe('rule presets', () => {
	describe('rulesForPreset', () => {
		it('gives the app defaults for the UK table', () => {
			expect(rulesForPreset('uk')).toEqual(DEFAULT_RULE_SET);
		});

		it('has no rules for Custom', () => {
			expect(rulesForPreset('custom')).toBeNull();
		});

		it('deals a hole card and late surrender in Vegas', () => {
			const vegas = rulesForPreset('vegas')!;
			expect(vegas.dealerPeek).toBe(true);
			expect(vegas.dealerHitsSoft17).toBe(true);
			expect(vegas.surrender).toBe('late');
		});

		it('lets only the UK hit split aces', () => {
			expect(rulesForPreset('uk')!.hitSplitAces).toBe(true);
			expect(rulesForPreset('europe')!.hitSplitAces).toBe(false);
			expect(rulesForPreset('vegas')!.hitSplitAces).toBe(false);
		});
	});

	describe('presetForRules', () => {
		it('recovers each preset from its own rules', () => {
			for (const preset of RULE_PRESETS) {
				if (preset.rules === null) continue;
				expect(presetForRules(preset.rules)).toBe(preset.id);
			}
		});

		it('calls a hand-edited rule set Custom', () => {
			const edited: RuleSet = { ...DEFAULT_RULE_SET, blackjackPayout: '6:5' };
			expect(presetForRules(edited)).toBe('custom');
		});

		// Every preset is a distinct table, so no two can claim the same rules.
		it('gives every preset rules of its own', () => {
			const ids = RULE_PRESETS.filter((preset) => preset.rules !== null).map((preset) =>
				presetForRules(preset.rules!)
			);
			expect(new Set(ids).size).toBe(ids.length);
		});
	});

	describe('ruleSetsEqual', () => {
		it('holds for a copy', () => {
			expect(ruleSetsEqual(DEFAULT_RULE_SET, { ...DEFAULT_RULE_SET })).toBe(true);
		});

		it('notices a change to any single rule', () => {
			const changes: Partial<RuleSet>[] = [
				{ decks: 2 },
				{ dealerHitsSoft17: true },
				{ penetrationPercent: 50 },
				{ blackjackPayout: '6:5' },
				{ surrender: 'late' },
				{ splitLimit: 2 },
				{ doubleAfterSplit: false },
				{ resplitAces: true },
				{ hitSplitAces: false },
				{ dealerPeek: true },
				{ insurance: false },
			];
			for (const change of changes) {
				expect(ruleSetsEqual(DEFAULT_RULE_SET, { ...DEFAULT_RULE_SET, ...change })).toBe(
					false
				);
			}
		});
	});
});
