/**
 * Insurance: the side bet a dealer ace offers, priced straight off the shoe
 * composition. It never touches the hit/stand recursion -- the only question it
 * asks is how dense the tens are behind an ace upcard. See docs/ev-model.md
 * §Insurance.
 */

import { CARD_UNITS, RANK_INDEX } from './cards';
import type { Composition } from './composition';
import type { RuleSet } from './rules';

/** Insurance pays 2:1 on the half-unit staked; the ratio is not a table variation. */
export const INSURANCE_PAYOUT = 2;

/**
 * The ten density at which insurance is a coin flip: 1/3, since a bet paying
 * 2:1 breaks even when it wins one time in three.
 */
export const INSURANCE_BREAK_EVEN_PERCENT = 100 / (INSURANCE_PAYOUT + 1);

/** Insurance read against a count-adjusted shoe, beside the unadjusted one. */
export interface InsuranceAnalysis {
	/** Whether the table offers the bet at all (`RuleSet.insurance`). */
	offered: boolean;
	/** Chance the hole card behind the ace is a ten, count-adjusted. */
	tenPercent: number;
	baseEvPercent: number;
	countEvPercent: number;
	deltaPercentPoints: number;
}

/**
 * Chance the hole card is a ten, with the ace upcard removed from the shoe and
 * nothing else -- the player's own cards stay in, as everywhere else in the
 * engine (docs/ev-model.md §Simplifications (1)).
 */
export function insuranceTenFraction(comp: Composition): number {
	const remaining = comp.reduce((sum, halfCards) => sum + halfCards, 0) - CARD_UNITS;
	if (remaining < CARD_UNITS) return 0;
	return comp[RANK_INDEX.T] / remaining;
}

/**
 * EV of taking insurance, in percent of the units staked *on the insurance bet*
 * -- not of the main wager, which stakes half as much on it. Positive means the
 * bet is worth taking.
 */
export function insuranceEvPercent(comp: Composition): number {
	const tenFraction = insuranceTenFraction(comp);
	return ((INSURANCE_PAYOUT + 1) * tenFraction - 1) * 100;
}

export function analyzeInsurance(
	ruleSet: RuleSet,
	base: Composition,
	count: Composition
): InsuranceAnalysis {
	const baseEvPercent = insuranceEvPercent(base);
	const countEvPercent = insuranceEvPercent(count);
	return {
		offered: ruleSet.insurance,
		tenPercent: insuranceTenFraction(count) * 100,
		baseEvPercent,
		countEvPercent,
		deltaPercentPoints: countEvPercent - baseEvPercent,
	};
}
