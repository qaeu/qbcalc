/**
 * Table rules and the hand sets the tables are drawn over: what the calculator can
 * be told about a game, and what it enumerates.
 */

import { RANKS, type Rank } from './cards';

/** Optimal first action: hit, stand, double, surrender, or (pairs only) split. */
export type PlayerAction = 'H' | 'S' | 'D' | 'P' | 'R';

/** What a natural pays, written as it appears on the felt. */
export type BlackjackPayout = '3:2' | '6:5' | '1:1';

/**
 * Surrender availability: 'early' before the dealer checks for blackjack, 'late'
 * only after the check, 'none' at tables that don't offer it, and 'es10' for the
 * common half-measure of early surrender against a ten and nothing else.
 * See docs/ev-model.md §Surrender frames.
 */
export type Surrender = 'early' | 'es10' | 'late' | 'none';

/**
 * The table variations the calculator knows about. All of them reach the play
 * grids except `penetrationPercent`, `blackjackPayout` and `insurance` -- see
 * docs/ev-model.md §Rules that don't reach the maths.
 */
export interface RuleSet {
	decks: number;
	dealerHitsSoft17: boolean;
	/** Percentage of the shoe dealt out before the shuffle. */
	penetrationPercent: number;
	blackjackPayout: BlackjackPayout;
	surrender: Surrender;
	/** Total hands one starting hand may be split into (1 = no splitting). */
	splitLimit: number;
	/** Doubling after a split is allowed. */
	doubleAfterSplit: boolean;
	/** Split aces may be split again. */
	resplitAces: boolean;
	/**
	 * Split aces may be drawn to normally instead of taking exactly one card.
	 * Rare, but standard in UK casinos.
	 */
	hitSplitAces: boolean;
	/** Dealer checks for blackjack against a ten or ace upcard. */
	dealerPeek: boolean;
	/**
	 * The table offers insurance against a dealer ace. A side bet on the hole
	 * card, so it prices itself off the composition rather than through the
	 * play grids -- see docs/ev-model.md §Insurance.
	 */
	insurance: boolean;
}

export const HARD_TOTALS: readonly number[] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
/**
 * Soft totals A,2 (13) through A,9 (20), i.e. an ace plus one non-ace card. A,T
 * (21) is omitted: it's a made blackjack-value hand where hitting is never a real
 * decision, so there's no optimal-play comparison to show.
 */
export const SOFT_TOTALS: readonly number[] = [13, 14, 15, 16, 17, 18, 19, 20];
/** Splittable pairs 2,2 through T,T and A,A -- one entry per rank. */
export const PAIR_RANKS: readonly Rank[] = RANKS;
export const BLACKJACK_PAYOUTS: readonly BlackjackPayout[] = ['3:2', '6:5', '1:1'];
export const SURRENDERS: readonly Surrender[] = ['early', 'es10', 'late', 'none'];

export const DEFAULT_RULE_SET: RuleSet = {
	decks: 6,
	dealerHitsSoft17: false,
	penetrationPercent: 75,
	blackjackPayout: '3:2',
	surrender: 'none',
	splitLimit: 4,
	doubleAfterSplit: true,
	resplitAces: false,
	hitSplitAces: true,
	dealerPeek: false,
	insurance: true,
};

/**
 * Identifies a rule set for caching purposes: two rule sets sharing a key produce
 * identical grids from the same composition. It covers exactly the fields the
 * engine reads, plus the deck count the composition needs -- extend it alongside
 * the models if a rule ever starts reaching the maths.
 */
export function ruleSetKey(ruleSet: RuleSet): string {
	return [
		ruleSet.decks,
		ruleSet.dealerHitsSoft17 ? 1 : 0,
		ruleSet.dealerPeek ? 1 : 0,
		ruleSet.doubleAfterSplit ? 1 : 0,
		ruleSet.splitLimit,
		ruleSet.resplitAces ? 1 : 0,
		ruleSet.hitSplitAces ? 1 : 0,
		ruleSet.surrender,
	].join('|');
}
