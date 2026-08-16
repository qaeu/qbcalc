import { describe, it, expect } from 'vitest';

import { RANK_INDEX } from '#utils/ev/cards';
import { applyTrueCountToComposition, baseComposition } from '#utils/ev/composition';
import {
	analyzeInsurance,
	insuranceEvPercent,
	insuranceTenFraction,
	INSURANCE_BREAK_EVEN_PERCENT,
} from '#utils/ev/insurance';
import { DEFAULT_RULE_SET, type RuleSet } from '#utils/ev/rules';

const RULE_SET: RuleSet = { ...DEFAULT_RULE_SET, decks: 6, insurance: true };

/** A ten-count tag vector: +1 per non-ten seen, -4 per ten (a balanced count). */
const TEN_COUNT_TAGS = {
	'2': 1,
	'3': 1,
	'4': 1,
	'5': 1,
	'6': 1,
	'7': 1,
	'8': 1,
	'9': 1,
	T: -4,
	A: 1,
} as const;

describe('insuranceTenFraction', () => {
	it('reads the ten density behind the ace, with only the upcard removed', () => {
		const comp = baseComposition(RULE_SET);
		// 6 decks: 96 tens out of 312 cards, less the ace upcard.
		expect(insuranceTenFraction(comp)).toBeCloseTo(96 / 311, 10);
	});

	it('rises as the count strips non-tens out of the shoe', () => {
		const base = baseComposition(RULE_SET);
		const rich = applyTrueCountToComposition(base, TEN_COUNT_TAGS, 5);
		expect(insuranceTenFraction(rich)).toBeGreaterThan(insuranceTenFraction(base));
	});
});

describe('insuranceEvPercent', () => {
	it('prices a fresh shoe at the usual house edge on the bet', () => {
		// 3p - 1 with p = 96/311 is about -7.4% of the insurance stake.
		expect(insuranceEvPercent(baseComposition(RULE_SET))).toBeCloseTo(
			(3 * (96 / 311) - 1) * 100,
			10
		);
		expect(insuranceEvPercent(baseComposition(RULE_SET))).toBeLessThan(0);
	});

	it('breaks even exactly where the tens are a third of the shoe', () => {
		// One ten and two others left, in half-card units, plus the ace upcard.
		const comp = new Array(10).fill(0);
		comp[RANK_INDEX.T] = 2;
		comp[RANK_INDEX['9']] = 4;
		comp[RANK_INDEX.A] = 2;
		expect(insuranceTenFraction(comp) * 100).toBeCloseTo(
			INSURANCE_BREAK_EVEN_PERCENT,
			10
		);
		expect(insuranceEvPercent(comp)).toBeCloseTo(0, 10);
	});

	it('turns positive once the tens are denser than a third', () => {
		const comp = new Array(10).fill(0);
		comp[RANK_INDEX.T] = 6;
		comp[RANK_INDEX['9']] = 4;
		comp[RANK_INDEX.A] = 2;
		expect(insuranceEvPercent(comp)).toBeGreaterThan(0);
	});
});

describe('analyzeInsurance', () => {
	it('reads the count-adjusted shoe against the unadjusted one', () => {
		const base = baseComposition(RULE_SET);
		const rich = applyTrueCountToComposition(base, TEN_COUNT_TAGS, 5);
		const analysis = analyzeInsurance(RULE_SET, base, rich);

		expect(analysis.offered).toBe(true);
		expect(analysis.baseEvPercent).toBeCloseTo(insuranceEvPercent(base), 10);
		expect(analysis.countEvPercent).toBeCloseTo(insuranceEvPercent(rich), 10);
		expect(analysis.deltaPercentPoints).toBeCloseTo(
			analysis.countEvPercent - analysis.baseEvPercent,
			10
		);
		expect(analysis.tenPercent).toBeCloseTo(insuranceTenFraction(rich) * 100, 10);
		expect(analysis.deltaPercentPoints).toBeGreaterThan(0);
	});

	it('carries the table rule through untouched, without changing the price', () => {
		const comp = baseComposition(RULE_SET);
		const off = analyzeInsurance({ ...RULE_SET, insurance: false }, comp, comp);

		expect(off.offered).toBe(false);
		expect(off.countEvPercent).toBeCloseTo(insuranceEvPercent(comp), 10);
	});
});
