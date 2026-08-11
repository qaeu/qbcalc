/**
 * Composition-dependent blackjack EV calculator.
 *
 * Computes exact optimal-action EV for hard totals, soft totals, and
 * splittable pairs against each dealer upcard, for a full shoe and for a
 * shoe adjusted to simulate a given Ace-Five running count, then reports the
 * delta. Ported from the reference Python implementation.
 *
 * METHOD
 * ------
 * Dealer's final-hand distribution and the player's hit/stand EV are both
 * computed by exact recursive enumeration over the shoe composition (not
 * Monte Carlo). Card counts are tracked in "half-card" units (x2) so that a
 * 0.5-card Ace-Five adjustment stays an integer.
 *
 * KEY SIMPLIFICATIONS (documented, not hidden)
 * ----------------------------------------------
 * 1. The player's own cards are NOT removed from the shoe composition. Only
 *    the dealer's upcard is removed before computing dealer/player EV. This
 *    isolates the primary count effect (ten/five/ace density driving dealer
 *    bust and dealer-completion probabilities) while skipping the
 *    second-order effect of exactly which cards the player is holding. For
 *    split hands, this extends to the sibling hand too: each split hand's
 *    draws are computed independently against the same shoe composition,
 *    not conditioned on what the other hand actually drew.
 * 2. These tables only capture the *playing-decision* channel of the count.
 *    They do NOT include the extra 3:2 payout from more player blackjacks
 *    at the deal -- that only matters at the two-card stage, which is
 *    outside the scope of a hit/stand/double/split table.
 * 3. The Ace-Five running count is translated into a shoe composition by
 *    assuming the count value N was produced by removing exactly N/2 more
 *    fives than aces from a fresh shoe, split evenly: five-count -= N/2,
 *    ace-count += N/2 (real-card units). This is one reasonable way to
 *    collapse a count value into a composition -- it is NOT the only
 *    possible shoe that produces a given running count, since the same
 *    count can arise from many different actual removal histories.
 * 4. Split hands follow the common one-card-per-hand, must-stand rule for
 *    split aces, and no resplitting is modelled (a second pair after a
 *    split cannot be split again).
 */

export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'A';

/** Optimal first action: hit, stand, double, or (pairs only) split. */
export type PlayerAction = 'H' | 'S' | 'D' | 'P';

export interface RuleSet {
	decks: number;
	dealerHitsSoft17: boolean;
}

/** Shoe composition in half-card units, indexed by RANK_INDEX. */
export type Composition = readonly number[];

/** Fields an EV table cell (and its popover) needs, shared by every table's row shape. */
export interface EvCellData {
	baseEvPercent: number;
	countEvPercent: number;
	deltaPercentPoints: number;
	optimalAction: PlayerAction;
	playerBustOnHitPercent: number;
	dealerBustPercent: number;
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

export const RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
export const HARD_TOTALS: readonly number[] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
/**
 * Soft totals A,2 (13) through A,9 (20), i.e. an ace plus one non-ace card.
 * A,T (21) is omitted: it's a made blackjack-value hand where hitting is
 * never a real decision, so there's no optimal-play comparison to show.
 */
export const SOFT_TOTALS: readonly number[] = [13, 14, 15, 16, 17, 18, 19, 20];
/** Splittable pairs 2,2 through T,T and A,A -- one entry per rank. */
export const PAIR_RANKS: readonly Rank[] = RANKS;
export const DEFAULT_RULE_SET: RuleSet = { decks: 4, dealerHitsSoft17: true };

type DealerDist = Record<string, number>;

const RANK_INDEX: Record<Rank, number> = Object.fromEntries(
	RANKS.map((rank, index) => [rank, index])
) as Record<Rank, number>;

const RANK_VALUE: Record<Rank, number> = {
	'2': 2,
	'3': 3,
	'4': 4,
	'5': 5,
	'6': 6,
	'7': 7,
	'8': 8,
	'9': 9,
	T: 10,
	A: 11,
};

function removeCard(comp: Composition, rank: Rank): Composition {
	const next = comp.slice();
	next[RANK_INDEX[rank]] -= 1;
	return next;
}

function addValue(total: number, soft: boolean, rank: Rank): [number, boolean] {
	const newTotalRaw = total + RANK_VALUE[rank];
	const newSoftRaw = soft || rank === 'A';
	if (newTotalRaw > 21 && newSoftRaw) {
		return [newTotalRaw - 10, false];
	}
	return [newTotalRaw, newSoftRaw];
}

/** Fast, collision-free memo key: one char per rank count plus total/soft/upcard. */
function compKey(comp: Composition): string {
	return String.fromCharCode(...comp);
}

interface CellAnalysis {
	optimalAction: PlayerAction;
	playerBustOnHitPercent: number;
	dealerBustPercent: number;
}

interface SplitCellAnalysis {
	evPercent: number;
	optimalAction: PlayerAction;
	playerBustOnHitPercent: number;
	dealerBustPercent: number;
}

/** The two-card hard/soft total of a pair, e.g. 8,8 -> hard 16; A,A -> hard 12
 * (only one ace can count as 11 once both are combined into one hand). */
function pairTotal(rank: Rank): [number, boolean] {
	const [afterFirst, softAfterFirst] = addValue(0, false, rank);
	return addValue(afterFirst, softAfterFirst, rank);
}

class ShoeEv {
	private readonly h17: boolean;
	private readonly memoDealer = new Map<string, DealerDist>();
	private readonly memoPlayer = new Map<string, number>();

	constructor(ruleSet: RuleSet) {
		this.h17 = ruleSet.dealerHitsSoft17;
	}

	private dealerDist(comp: Composition, total: number, soft: boolean): DealerDist {
		const key = compKey(comp) + String.fromCharCode(total, soft ? 1 : 0);
		const cached = this.memoDealer.get(key);
		if (cached) return cached;

		if (total > 21) {
			const res = { bust: 1.0 };
			this.memoDealer.set(key, res);
			return res;
		}

		const stands = total >= 18 || (total === 17 && (!soft || !this.h17));
		if (stands) {
			const res = { [total]: 1.0 };
			this.memoDealer.set(key, res);
			return res;
		}

		const totCards = comp.reduce((sum, n) => sum + n, 0);
		const res: DealerDist = {};
		if (totCards === 0) {
			res[total] = 1.0;
			this.memoDealer.set(key, res);
			return res;
		}

		for (const rank of RANKS) {
			const n = comp[RANK_INDEX[rank]];
			if (n <= 0) continue;
			const p = n / totCards;
			const newComp = removeCard(comp, rank);
			const [newTotal, newSoft] = addValue(total, soft, rank);
			const sub = this.dealerDist(newComp, newTotal, newSoft);
			for (const k in sub) {
				res[k] = (res[k] ?? 0) + p * sub[k];
			}
		}

		this.memoDealer.set(key, res);
		return res;
	}

	private standEv(comp: Composition, playerTotal: number, upcard: Rank): number {
		const startTotal = upcard === 'A' ? 11 : RANK_VALUE[upcard];
		const dist = this.dealerDist(comp, startTotal, upcard === 'A');
		let ev = 0.0;
		for (const key in dist) {
			const p = dist[key];
			if (key === 'bust') {
				ev += p;
			} else {
				const outcome = Number(key);
				if (outcome < playerTotal) ev += p;
				else if (outcome > playerTotal) ev -= p;
			}
		}
		return ev;
	}

	private hitEv(comp: Composition, total: number, soft: boolean, upcard: Rank): number {
		const totCards = comp.reduce((sum, n) => sum + n, 0);
		let evHit = 0.0;
		for (const rank of RANKS) {
			const n = comp[RANK_INDEX[rank]];
			if (n <= 0) continue;
			const p = n / totCards;
			const newComp = removeCard(comp, rank);
			const [newTotal, newSoft] = addValue(total, soft, rank);
			evHit += p * this.bestEv(newComp, newTotal, newSoft, upcard);
		}
		return evHit;
	}

	private bestEv(comp: Composition, total: number, soft: boolean, upcard: Rank): number {
		if (total > 21) return -1.0;

		const key = compKey(comp) + String.fromCharCode(total, soft ? 1 : 0) + upcard;
		const cached = this.memoPlayer.get(key);
		if (cached !== undefined) return cached;

		const evStand = this.standEv(comp, total, upcard);
		if (total >= 21) {
			this.memoPlayer.set(key, evStand);
			return evStand;
		}

		const totCards = comp.reduce((sum, n) => sum + n, 0);
		const evHit = totCards > 0 ? this.hitEv(comp, total, soft, upcard) : 0.0;

		const best = Math.max(evStand, evHit);
		this.memoPlayer.set(key, best);
		return best;
	}

	/** EV of taking exactly one more card, then being forced to stand, at double the bet. */
	private doubleEv(
		comp: Composition,
		total: number,
		soft: boolean,
		upcard: Rank
	): number {
		const totCards = comp.reduce((sum, n) => sum + n, 0);
		if (totCards === 0) return this.standEv(comp, total, upcard) * 2;

		let ev = 0.0;
		for (const rank of RANKS) {
			const n = comp[RANK_INDEX[rank]];
			if (n <= 0) continue;
			const p = n / totCards;
			const [newTotal] = addValue(total, soft, rank);
			if (newTotal > 21) {
				ev += p * -2;
				continue;
			}
			const newComp = removeCard(comp, rank);
			ev += p * 2 * this.standEv(newComp, newTotal, upcard);
		}
		return ev;
	}

	/** Probability that a single hit card busts the player's current total. */
	private playerBustOnHitProb(comp: Composition, total: number, soft: boolean): number {
		const totCards = comp.reduce((sum, n) => sum + n, 0);
		if (totCards === 0) return 0;

		let bustP = 0.0;
		for (const rank of RANKS) {
			const n = comp[RANK_INDEX[rank]];
			if (n <= 0) continue;
			const [newTotal] = addValue(total, soft, rank);
			if (newTotal > 21) bustP += n / totCards;
		}
		return bustP;
	}

	private dealerBustProb(comp: Composition, upcard: Rank): number {
		const startTotal = upcard === 'A' ? 11 : RANK_VALUE[upcard];
		const dist = this.dealerDist(comp, startTotal, upcard === 'A');
		return dist['bust'] ?? 0;
	}

	grid(
		comp0: Composition,
		totals: readonly number[],
		upcards: readonly Rank[],
		soft = false
	): Map<string, number> {
		const out = new Map<string, number>();
		for (const upcard of upcards) {
			const compUpcard = removeCard(comp0, upcard);
			for (const total of totals) {
				out.set(gridKey(total, upcard), this.bestEv(compUpcard, total, soft, upcard));
			}
		}
		return out;
	}

	/** Optimal action (incl. doubling) and bust odds, independent of the hit/stand-only `grid()` EV. */
	analyzeGrid(
		comp0: Composition,
		totals: readonly number[],
		upcards: readonly Rank[],
		soft = false
	): Map<string, CellAnalysis> {
		const out = new Map<string, CellAnalysis>();
		for (const upcard of upcards) {
			const compUpcard = removeCard(comp0, upcard);
			const dealerBustPercent = this.dealerBustProb(compUpcard, upcard) * 100;
			for (const total of totals) {
				// A made 21 (e.g. soft A,T) is always stood on -- hitting it is not a
				// real decision, and addValue's single-ace-demotion adjustment isn't
				// meant to handle drawing a second ace on top of an already-soft 21.
				if (total >= 21) {
					out.set(gridKey(total, upcard), {
						optimalAction: 'S',
						playerBustOnHitPercent: 0,
						dealerBustPercent,
					});
					continue;
				}

				const evStand = this.standEv(compUpcard, total, upcard);
				const evHit = this.hitEv(compUpcard, total, soft, upcard);
				const evDouble = this.doubleEv(compUpcard, total, soft, upcard);

				let optimalAction: PlayerAction = 'S';
				let best = evStand;
				if (evDouble > best) {
					best = evDouble;
					optimalAction = 'D';
				}
				if (evHit > best) {
					optimalAction = 'H';
				}

				out.set(gridKey(total, upcard), {
					optimalAction,
					playerBustOnHitPercent: this.playerBustOnHitProb(compUpcard, total, soft) * 100,
					dealerBustPercent,
				});
			}
		}
		return out;
	}

	/**
	 * EV of splitting a pair into two independent hands, each starting from
	 * one card of `rank` plus a mandatory second card, then played optimally
	 * (hit/stand/double). Split aces follow the common one-card-per-hand,
	 * must-stand rule. Both hands draw against the same shoe composition --
	 * the second hand's draws are not conditioned on the first hand's actual
	 * draws, extending simplification #1 (own cards not removed) to sibling
	 * split hands. No resplitting is modelled.
	 */
	private splitHandEv(comp: Composition, rank: Rank, upcard: Rank): number {
		const isAce = rank === 'A';
		const startTotal = RANK_VALUE[rank];
		const totCards = comp.reduce((sum, n) => sum + n, 0);
		if (totCards === 0) return this.standEv(comp, startTotal, upcard);

		let ev = 0.0;
		for (const drawRank of RANKS) {
			const n = comp[RANK_INDEX[drawRank]];
			if (n <= 0) continue;
			const p = n / totCards;
			const newComp = removeCard(comp, drawRank);
			const [newTotal, newSoft] = addValue(startTotal, isAce, drawRank);

			if (isAce) {
				ev += p * this.standEv(newComp, newTotal, upcard);
				continue;
			}
			const evStand = this.standEv(newComp, newTotal, upcard);
			const evHit = this.hitEv(newComp, newTotal, newSoft, upcard);
			const evDouble = this.doubleEv(newComp, newTotal, newSoft, upcard);
			ev += p * Math.max(evStand, evHit, evDouble);
		}
		return ev;
	}

	private splitEv(comp: Composition, rank: Rank, upcard: Rank): number {
		return 2 * this.splitHandEv(comp, rank, upcard);
	}

	/** Optimal action (incl. splitting) and EV/bust odds for each pair vs. upcard. */
	analyzeSplitGrid(
		comp0: Composition,
		pairRanks: readonly Rank[],
		upcards: readonly Rank[]
	): Map<string, SplitCellAnalysis> {
		const out = new Map<string, SplitCellAnalysis>();
		for (const upcard of upcards) {
			const compUpcard = removeCard(comp0, upcard);
			const dealerBustPercent = this.dealerBustProb(compUpcard, upcard) * 100;
			for (const rank of pairRanks) {
				const [total, soft] = pairTotal(rank);
				const evStand = this.standEv(compUpcard, total, upcard);
				const evHit = this.hitEv(compUpcard, total, soft, upcard);
				const evDouble = this.doubleEv(compUpcard, total, soft, upcard);
				const evSplit = this.splitEv(compUpcard, rank, upcard);

				let optimalAction: PlayerAction = 'S';
				let best = evStand;
				if (evDouble > best) {
					best = evDouble;
					optimalAction = 'D';
				}
				if (evHit > best) {
					best = evHit;
					optimalAction = 'H';
				}
				if (evSplit > best) {
					best = evSplit;
					optimalAction = 'P';
				}

				out.set(splitGridKey(rank, upcard), {
					evPercent: best * 100,
					optimalAction,
					playerBustOnHitPercent: this.playerBustOnHitProb(compUpcard, total, soft) * 100,
					dealerBustPercent,
				});
			}
		}
		return out;
	}
}

function gridKey(total: number, upcard: Rank): string {
	return `${total}-${upcard}`;
}

function splitGridKey(rank: Rank, upcard: Rank): string {
	return `${rank}-${upcard}`;
}

export function baseComposition(ruleSet: RuleSet): Composition {
	const comp = new Array(10).fill(0);
	for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9'] as Rank[]) {
		comp[RANK_INDEX[rank]] = 4 * ruleSet.decks * 2;
	}
	comp[RANK_INDEX.T] = 16 * ruleSet.decks * 2;
	comp[RANK_INDEX.A] = 4 * ruleSet.decks * 2;
	return comp;
}

/**
 * Adjusts a composition to represent a given Ace-Five running count.
 * count = +N -> N/2 fewer real fives, N/2 more real aces (see module docs).
 * Works in half-card units, so `count` (an integer) maps directly to a
 * `count`-unit shift split across the two ranks.
 */
export function applyAceFiveCount(comp: Composition, count: number): Composition {
	const next = comp.slice();
	next[RANK_INDEX['5']] -= count;
	next[RANK_INDEX.A] += count;
	if (next[RANK_INDEX['5']] < 0 || next[RANK_INDEX.A] < 0) {
		throw new Error('Count too extreme for this shoe size (negative card count).');
	}
	return next;
}

/**
 * Builds one hard/soft-totals comparison table from a pair of engines the
 * caller already has (one warmed on `base`, one on `modified`). Sharing
 * engines across tables lets their memo caches carry over instead of
 * recomputing identical dealer/player recursion states from scratch --
 * see `computeAllEvTables`.
 */
function buildEvComparison(
	baseEngine: ShoeEv,
	countEngine: ShoeEv,
	base: Composition,
	modified: Composition,
	totals: readonly number[],
	upcards: readonly Rank[],
	soft: boolean
): EvComparisonResult {
	const baseGrid = baseEngine.grid(base, totals, upcards, soft);
	const modGrid = countEngine.grid(modified, totals, upcards, soft);
	const analysisGrid = countEngine.analyzeGrid(modified, totals, upcards, soft);

	const rows: EvComparisonRow[] = [];
	for (const upcard of upcards) {
		for (const total of totals) {
			const key = gridKey(total, upcard);
			const baseEvPercent = (baseGrid.get(key) ?? 0) * 100;
			const countEvPercent = (modGrid.get(key) ?? 0) * 100;
			const analysis = analysisGrid.get(key)!;
			rows.push({
				total,
				upcard,
				baseEvPercent,
				countEvPercent,
				deltaPercentPoints: countEvPercent - baseEvPercent,
				optimalAction: analysis.optimalAction,
				playerBustOnHitPercent: analysis.playerBustOnHitPercent,
				dealerBustPercent: analysis.dealerBustPercent,
			});
		}
	}

	return { totals, upcards, rows };
}

export function computeEvComparison(
	ruleSet: RuleSet,
	count: number,
	totals: readonly number[] = HARD_TOTALS,
	upcards: readonly Rank[] = RANKS,
	soft = false
): EvComparisonResult {
	const base = baseComposition(ruleSet);
	const modified = applyAceFiveCount(base, Math.round(count));
	return buildEvComparison(
		new ShoeEv(ruleSet),
		new ShoeEv(ruleSet),
		base,
		modified,
		totals,
		upcards,
		soft
	);
}

/**
 * Unlike `computeEvComparison` (whose EV numbers are hit/stand-only, per the
 * module docs), each row's EV here is the fully optimal action's EV --
 * stand, hit, double, or split -- since split EV isn't expressible on the
 * hit/stand-only `bestEv` recursion. `optimalAction` is drawn from the same
 * comparison, so the displayed EV always matches the recommended action.
 */
/** Same sharing idea as `buildEvComparison`, for the splits table. */
function buildSplitEvComparison(
	baseEngine: ShoeEv,
	countEngine: ShoeEv,
	base: Composition,
	modified: Composition,
	pairRanks: readonly Rank[],
	upcards: readonly Rank[]
): SplitEvComparisonResult {
	const baseAnalysis = baseEngine.analyzeSplitGrid(base, pairRanks, upcards);
	const countAnalysis = countEngine.analyzeSplitGrid(modified, pairRanks, upcards);

	const rows: SplitEvComparisonRow[] = [];
	for (const upcard of upcards) {
		for (const rank of pairRanks) {
			const key = splitGridKey(rank, upcard);
			const baseCell = baseAnalysis.get(key)!;
			const countCell = countAnalysis.get(key)!;
			rows.push({
				pairRank: rank,
				upcard,
				baseEvPercent: baseCell.evPercent,
				countEvPercent: countCell.evPercent,
				deltaPercentPoints: countCell.evPercent - baseCell.evPercent,
				optimalAction: countCell.optimalAction,
				playerBustOnHitPercent: countCell.playerBustOnHitPercent,
				dealerBustPercent: countCell.dealerBustPercent,
			});
		}
	}

	return { pairRanks, upcards, rows };
}

export function computeSplitEvComparison(
	ruleSet: RuleSet,
	count: number,
	pairRanks: readonly Rank[] = PAIR_RANKS,
	upcards: readonly Rank[] = RANKS
): SplitEvComparisonResult {
	const base = baseComposition(ruleSet);
	const modified = applyAceFiveCount(base, Math.round(count));
	return buildSplitEvComparison(
		new ShoeEv(ruleSet),
		new ShoeEv(ruleSet),
		base,
		modified,
		pairRanks,
		upcards
	);
}

/**
 * Computes all three tables (hard totals, soft totals, splits) sharing one
 * engine for `base` and one for `modified` across all of them. Dealer
 * outcome distributions -- and, for split, the hit/stand/double sub-EVs --
 * depend only on shoe composition and hand-in-progress state, not on which
 * table triggered the computation, so the memo caches populated by the
 * first table are reused by the other two instead of being rebuilt from
 * scratch. This is the entry point `EvTable` should use; the single-table
 * `computeEvComparison`/`computeSplitEvComparison` functions above remain
 * for standalone/test use and always compute with fresh, unshared engines.
 */
export function computeAllEvTables(
	ruleSet: RuleSet,
	count: number
): {
	hard: EvComparisonResult;
	soft: EvComparisonResult;
	split: SplitEvComparisonResult;
} {
	const base = baseComposition(ruleSet);
	const modified = applyAceFiveCount(base, Math.round(count));
	const baseEngine = new ShoeEv(ruleSet);
	const countEngine = new ShoeEv(ruleSet);

	const hard = buildEvComparison(
		baseEngine,
		countEngine,
		base,
		modified,
		HARD_TOTALS,
		RANKS,
		false
	);
	const soft = buildEvComparison(
		baseEngine,
		countEngine,
		base,
		modified,
		SOFT_TOTALS,
		RANKS,
		true
	);
	const split = buildSplitEvComparison(
		baseEngine,
		countEngine,
		base,
		modified,
		PAIR_RANKS,
		RANKS
	);

	return { hard, soft, split };
}
