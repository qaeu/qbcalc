/**
 * The comparison tables the UI renders: a count-adjusted set of grids read
 * side by side with the unadjusted ones, plus the entry points that compute both
 * halves from a rule set and a count.
 */

import { RANKS, type Rank } from './cards';
import {
	ACE_FIVE_TAGS,
	applyCountToComposition,
	baseComposition,
	type TagValues,
} from './composition';
import {
	computeEvGrids,
	gridKey,
	ShoeEv,
	splitGridKey,
	type AverageEvParts,
	type CellAnalysis,
	type EvGrids,
} from './engine';
import { analyzeInsurance, type InsuranceAnalysis } from './insurance';
import type { ActionAnalysis } from './outcome';
import {
	HARD_TOTALS,
	PAIR_RANKS,
	SOFT_TOTALS,
	type BlackjackPayout,
	type PlayerAction,
	type RuleSet,
} from './rules';

/** Fields an EV table cell (and its popover) needs, shared by every table's row shape. */
export interface EvCellData {
	baseEvPercent: number;
	countEvPercent: number;
	deltaPercentPoints: number;
	optimalAction: PlayerAction;
	/**
	 * The optimal action for the unadjusted shoe. Where it differs from
	 * `optimalAction` the count has moved the play off basic strategy, which is
	 * what the table marks as a deviation.
	 */
	baseAction: PlayerAction;
	playerBustOnHitPercent: number;
	dealerBustPercent: number;
	/**
	 * Chance the opening deal produces this cell -- this hand against this upcard --
	 * as a percentage of rounds played, count-adjusted like the rest of the cell.
	 */
	occurrencePercent: number;
	/**
	 * Every action the table offers this hand, priced individually, in the engine's
	 * own preference order (the first of two equal EVs is the one `optimalAction`
	 * names). The drill-down dialog sorts them for display.
	 */
	actions: readonly ActionAnalysis[];
	/**
	 * The same actions priced against the unadjusted shoe, in the engine's own
	 * preference order. The drill-down dialog ranks these alongside `actions`
	 * to show how the count has reordered them.
	 */
	baseActions: readonly ActionAnalysis[];
}

export interface EvComparisonRow extends EvCellData {
	total: number;
	upcard: Rank;
}

export interface EvComparisonResult {
	totals: readonly number[];
	upcards: readonly Rank[];
	rows: readonly EvComparisonRow[];
}

export interface SplitEvComparisonRow extends EvCellData {
	pairRank: Rank;
	upcard: Rank;
}

export interface SplitEvComparisonResult {
	pairRanks: readonly Rank[];
	upcards: readonly Rank[];
	rows: readonly SplitEvComparisonRow[];
}

/** What one round is worth on average, count-adjusted and beside the unadjusted shoe. */
export interface AverageEvAnalysis {
	baseEvPercent: number;
	countEvPercent: number;
	deltaPercentPoints: number;
	/** Chance the deal hands the player a natural, count-adjusted. */
	naturalPercent: number;
	/**
	 * Variance of one round's result at a flat one-unit bet, in units², from the
	 * count-adjusted shoe. Bet sizing scales it by the square of the bet, which is
	 * what makes it the input a bankroll calculation needs -- see
	 * docs/bankroll-model.md.
	 */
	variancePerRound: number;
}

export interface EvTables {
	hard: EvComparisonResult;
	soft: EvComparisonResult;
	split: SplitEvComparisonResult;
	/**
	 * Not a grid: insurance is one number per shoe, priced off the composition
	 * alone, so it rides along with the tables rather than through the engine.
	 */
	insurance: InsuranceAnalysis;
	/** The whole of the three grids in one number -- see docs/ev-model.md §The average hand. */
	average: AverageEvAnalysis;
}

/** What a natural returns per unit wagered, as the felt writes it. */
const BLACKJACK_PAYOUT_VALUE: Record<BlackjackPayout, number> = {
	'3:2': 1.5,
	'6:5': 1.2,
	'1:1': 1,
};

/**
 * Prices the natural the engine set aside. This is the one place
 * `blackjackPayout` reaches a number, which is what keeps it out of the grids and
 * out of `ruleSetKey`.
 */
export function averageEvPercent(parts: AverageEvParts, payout: BlackjackPayout): number {
	return (
		parts.evPercentExNatural
		+ parts.naturalPayoutWeight * BLACKJACK_PAYOUT_VALUE[payout] * 100
	);
}

/**
 * The round's variance, from the same parts. A natural is the one hand whose
 * spread the payout decides, so it is squared in here exactly where
 * `averageEvPercent` adds it linearly; the pushed naturals contribute nothing to
 * either. `evPerRound` is in units, not percent.
 */
function averageVariance(
	parts: AverageEvParts,
	payout: BlackjackPayout,
	evPerRound: number
): number {
	const naturalValue = BLACKJACK_PAYOUT_VALUE[payout];
	const secondMoment =
		parts.secondMomentExNatural + parts.naturalPayoutWeight * naturalValue * naturalValue;
	return secondMoment - evPerRound * evPerRound;
}

function buildAverageEv(
	baseParts: AverageEvParts,
	countParts: AverageEvParts,
	payout: BlackjackPayout
): AverageEvAnalysis {
	const baseEvPercent = averageEvPercent(baseParts, payout);
	const countEvPercent = averageEvPercent(countParts, payout);
	return {
		baseEvPercent,
		countEvPercent,
		deltaPercentPoints: countEvPercent - baseEvPercent,
		naturalPercent: countParts.naturalProbability * 100,
		variancePerRound: averageVariance(countParts, payout, countEvPercent / 100),
	};
}

/** Pairs a base grid with a count-adjusted one into a hard/soft-totals table. */
function buildEvComparison(
	baseGrid: Map<string, CellAnalysis>,
	countGrid: Map<string, CellAnalysis>,
	totals: readonly number[],
	upcards: readonly Rank[]
): EvComparisonResult {
	const rows: EvComparisonRow[] = [];
	for (const upcard of upcards) {
		for (const total of totals) {
			const key = gridKey(total, upcard);
			const baseCell = baseGrid.get(key)!;
			const countCell = countGrid.get(key)!;
			rows.push({
				total,
				upcard,
				baseEvPercent: baseCell.evPercent,
				countEvPercent: countCell.evPercent,
				deltaPercentPoints: countCell.evPercent - baseCell.evPercent,
				optimalAction: countCell.optimalAction,
				baseAction: baseCell.optimalAction,
				playerBustOnHitPercent: countCell.playerBustOnHitPercent,
				dealerBustPercent: countCell.dealerBustPercent,
				occurrencePercent: countCell.occurrencePercent,
				actions: countCell.actions,
				baseActions: baseCell.actions,
			});
		}
	}

	return { totals, upcards, rows };
}

/**
 * Same, for the splits table. Each row's EV is the fully optimal action's EV --
 * stand, hit, double, or split -- as in the hard/soft tables, and `optimalAction`
 * is drawn from the same comparison, so the displayed EV always matches the
 * recommended action.
 */
function buildSplitEvComparison(
	baseGrid: Map<string, CellAnalysis>,
	countGrid: Map<string, CellAnalysis>,
	pairRanks: readonly Rank[],
	upcards: readonly Rank[]
): SplitEvComparisonResult {
	const rows: SplitEvComparisonRow[] = [];
	for (const upcard of upcards) {
		for (const rank of pairRanks) {
			const key = splitGridKey(rank, upcard);
			const baseCell = baseGrid.get(key)!;
			const countCell = countGrid.get(key)!;
			rows.push({
				pairRank: rank,
				upcard,
				baseEvPercent: baseCell.evPercent,
				countEvPercent: countCell.evPercent,
				deltaPercentPoints: countCell.evPercent - baseCell.evPercent,
				optimalAction: countCell.optimalAction,
				baseAction: baseCell.optimalAction,
				playerBustOnHitPercent: countCell.playerBustOnHitPercent,
				dealerBustPercent: countCell.dealerBustPercent,
				occurrencePercent: countCell.occurrencePercent,
				actions: countCell.actions,
				baseActions: baseCell.actions,
			});
		}
	}

	return { pairRanks, upcards, rows };
}

export function computeEvComparison(
	ruleSet: RuleSet,
	count: number,
	tags: TagValues = ACE_FIVE_TAGS,
	totals: readonly number[] = HARD_TOTALS,
	upcards: readonly Rank[] = RANKS,
	soft = false
): EvComparisonResult {
	const base = baseComposition(ruleSet);
	const modified = applyCountToComposition(base, tags, count);
	return buildEvComparison(
		new ShoeEv(ruleSet).analyzeGrid(base, totals, upcards, soft),
		new ShoeEv(ruleSet).analyzeGrid(modified, totals, upcards, soft),
		totals,
		upcards
	);
}

export function computeSplitEvComparison(
	ruleSet: RuleSet,
	count: number,
	tags: TagValues = ACE_FIVE_TAGS,
	pairRanks: readonly Rank[] = PAIR_RANKS,
	upcards: readonly Rank[] = RANKS
): SplitEvComparisonResult {
	const base = baseComposition(ruleSet);
	const modified = applyCountToComposition(base, tags, count);
	return buildSplitEvComparison(
		new ShoeEv(ruleSet).analyzeSplitGrid(base, pairRanks, upcards),
		new ShoeEv(ruleSet).analyzeSplitGrid(modified, pairRanks, upcards),
		pairRanks,
		upcards
	);
}

/**
 * Reads a count-adjusted set of grids against the unadjusted ones. Insurance is
 * passed in already priced: it comes from the two compositions rather than from
 * the grids, and the caller is the one holding those.
 */
export function combineEvTables(
	ruleSet: RuleSet,
	baseGrids: EvGrids,
	countGrids: EvGrids,
	insurance: InsuranceAnalysis
): EvTables {
	return {
		hard: buildEvComparison(baseGrids.hard, countGrids.hard, HARD_TOTALS, RANKS),
		soft: buildEvComparison(baseGrids.soft, countGrids.soft, SOFT_TOTALS, RANKS),
		split: buildSplitEvComparison(baseGrids.split, countGrids.split, PAIR_RANKS, RANKS),
		insurance,
		average: buildAverageEv(
			baseGrids.average,
			countGrids.average,
			ruleSet.blackjackPayout
		),
	};
}

/**
 * Computes all three tables (hard totals, soft totals, splits) from scratch. This
 * is the entry point for standalone and test use; `EvTable` reaches the engine
 * through the worker, which splits the same work into `computeEvGrids` and
 * `combineEvTables` so it can cache the base composition's grids.
 */
export function computeAllEvTables(
	ruleSet: RuleSet,
	count: number,
	tags: TagValues = ACE_FIVE_TAGS
): EvTables {
	const base = baseComposition(ruleSet);
	const modified = applyCountToComposition(base, tags, count);
	return combineEvTables(
		ruleSet,
		computeEvGrids(ruleSet, base),
		computeEvGrids(ruleSet, modified),
		analyzeInsurance(ruleSet, base, modified)
	);
}
