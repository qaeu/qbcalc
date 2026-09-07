/**
 * The grids a *played* hand is looked up in: every action a cell offers, priced
 * against the count-adjusted shoe and against the unadjusted one. Wider than the
 * strategy tables `rules.ts` draws, because a played hand reaches totals a
 * strategy table has nothing to say about.
 *
 * Kept here rather than in `evWorkerProtocol.ts`, where it started, because two
 * workers now build these: the EV worker answers the Play view's coach with them,
 * and the sim worker prices its own for the policy to play off. One
 * implementation, so the two can never drift into grading and playing different
 * games. See docs/play-model.md §The grading basis.
 */

import { RANKS } from './cards';
import type { Composition } from './composition';
import { ShoeEv, type CellAnalysis } from './engine';
import type { ActionAnalysis } from './outcome';
import { precisionFor, type PrecisionId } from './precision';
import { PAIR_RANKS, type RuleSet } from './rules';

/**
 * Hard totals the Play grids are walked over. Wider than `HARD_TOTALS`, which
 * covers the totals a strategy table has anything to say about: a played hand can
 * hold hard 4 (2,2) or hit its way to hard 20, and a hand the grids do not reach
 * is a hand the coach cannot grade.
 */
export const PLAY_HARD_TOTALS: readonly number[] = [
	4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
];

/**
 * Soft totals the same grids are walked over: A,A (12) through soft 21. Soft 21
 * is priced as the stand it always is -- see `ShoeEv.analyzeGrid` -- so its cell
 * carries one action, which the coach handles like any other.
 */
export const PLAY_SOFT_TOTALS: readonly number[] = [
	12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
];

/**
 * One graded cell: every action the table offers this hand, priced against the
 * count-adjusted shoe and against the unadjusted one. The pair is what separates
 * a basic-strategy error from a missed deviation -- see `play/coach.ts`.
 */
export interface PlayCell {
	actions: readonly ActionAnalysis[];
	baseActions: readonly ActionAnalysis[];
}

/** The three grids the Play view's coach looks a live hand up in. */
export interface PlayGrids {
	hard: Map<string, PlayCell>;
	soft: Map<string, PlayCell>;
	split: Map<string, PlayCell>;
}

/** One composition's Play grids, before a base set and a count set are paired. */
export interface PlayRawGrids {
	hard: Map<string, CellAnalysis>;
	soft: Map<string, CellAnalysis>;
	split: Map<string, CellAnalysis>;
}

/**
 * The widened grids for one composition. One engine for all three, as
 * `computeEvGrids` does, so the memos the first grid fills serve the other two --
 * and no `analyzeAverage` and no edge curve, neither of which a played hand reads.
 */
export function playGridsFor(
	ruleSet: RuleSet,
	comp: Composition,
	precision: PrecisionId
): PlayRawGrids {
	const engine = new ShoeEv(ruleSet, precisionFor(precision));
	return {
		hard: engine.analyzeGrid(comp, PLAY_HARD_TOTALS, RANKS, false),
		soft: engine.analyzeGrid(comp, PLAY_SOFT_TOTALS, RANKS, true),
		split: engine.analyzeSplitGrid(comp, PAIR_RANKS, RANKS),
	};
}

/** One count-adjusted grid paired with the unadjusted one, cell by cell. */
export function pairPlayGrid(
	baseGrid: Map<string, CellAnalysis>,
	countGrid: Map<string, CellAnalysis>
): Map<string, PlayCell> {
	const out = new Map<string, PlayCell>();
	for (const [key, countCell] of countGrid) {
		out.set(key, { actions: countCell.actions, baseActions: baseGrid.get(key)!.actions });
	}
	return out;
}

/** All three grids paired at once, which is what a caller actually wants. */
export function pairPlayGrids(base: PlayRawGrids, count: PlayRawGrids): PlayGrids {
	return {
		hard: pairPlayGrid(base.hard, count.hard),
		soft: pairPlayGrid(base.soft, count.soft),
		split: pairPlayGrid(base.split, count.split),
	};
}
