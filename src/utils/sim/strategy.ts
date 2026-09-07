/**
 * The priced grids a run plays off, one set per whole true count, built on demand
 * and kept for the worker's lifetime. Pricing a count is the expensive part of a
 * sim -- about a second each -- and dealing against one is not, so the first run
 * under a new game pays for a handful of counts and every later run costs
 * nothing. See docs/sim-model.md §Pricing the counts.
 */

import { RANKS } from '../ev/cards';
import {
	applyTrueCountToComposition,
	baseComposition,
	type Composition,
	type TagValues,
} from '../ev/composition';
import {
	pairPlayGrids,
	playGridsFor,
	type PlayGrids,
	type PlayRawGrids,
} from '../ev/playGrids';
import type { PrecisionId } from '../ev/precision';
import { ruleSetKey, type RuleSet } from '../ev/rules';

/**
 * How far from zero a count is priced before it is simply clamped. Past ±10 the
 * composition `applyTrueCountToComposition` builds is barely representable -- the
 * removals it asks for approach what the shoe holds -- and the play it produces
 * has stopped changing anyway.
 */
export const MAX_PRICED_COUNT = 10;

/** What a run needs from the counts it visits, and how much of it has been paid for. */
export interface Strategy {
	/** The grids for a true count, rounded and clamped. Prices on first ask. */
	gridsFor(trueCount: number): PlayGrids;
	/** The count-adjusted composition for the same count, for insurance. */
	compFor(trueCount: number): Composition;
	/** How many counts this run has had to price, for the progress report. */
	pricedCount(): number;
}

/**
 * Shared across every `createStrategy` call, so a second run under the same game
 * -- a different seed, a different ramp, a different deviation mode -- deals
 * immediately instead of repricing what the first run already walked.
 */
const gridCache = new Map<string, PlayGrids>();
const baseCache = new Map<string, PlayRawGrids>();

function basisKey(ruleSet: RuleSet, tags: TagValues, precision: PrecisionId): string {
	return [ruleSetKey(ruleSet), RANKS.map((rank) => tags[rank]).join(','), precision].join(
		'|'
	);
}

/** The count a shoe standing at `trueCount` is played off. */
export function pricedCountFor(trueCount: number): number {
	return Math.max(-MAX_PRICED_COUNT, Math.min(MAX_PRICED_COUNT, Math.round(trueCount)));
}

export function createStrategy(
	ruleSet: RuleSet,
	tags: TagValues,
	precision: PrecisionId
): Strategy {
	const basis = basisKey(ruleSet, tags, precision);
	const base = baseComposition(ruleSet);
	const comps = new Map<number, Composition>();
	let priced = 0;

	const baseGrids = (): PlayRawGrids => {
		let grids = baseCache.get(basis);
		if (grids === undefined) {
			grids = playGridsFor(ruleSet, base, precision);
			baseCache.set(basis, grids);
			priced += 1;
		}
		return grids;
	};

	const compFor = (trueCount: number): Composition => {
		const count = pricedCountFor(trueCount);
		let comp = comps.get(count);
		if (comp === undefined) {
			comp = applyTrueCountToComposition(base, tags, count);
			comps.set(count, comp);
		}
		return comp;
	};

	return {
		gridsFor(trueCount) {
			const count = pricedCountFor(trueCount);
			const key = `${basis}|${count}`;
			const cached = gridCache.get(key);
			if (cached !== undefined) return cached;

			const unadjusted = baseGrids();
			const comp = compFor(count);
			// A count that moves not a single half-card is the baseline itself, and
			// pairing the baseline with itself is both grids for the price of none.
			const countGrids =
				comp.every((halfCards, index) => halfCards === base[index]) ? unadjusted : (
					playGridsFor(ruleSet, comp, precision)
				);
			if (countGrids !== unadjusted) priced += 1;
			const grids = pairPlayGrids(unadjusted, countGrids);
			gridCache.set(key, grids);
			return grids;
		},
		compFor,
		pricedCount: () => priced,
	};
}
