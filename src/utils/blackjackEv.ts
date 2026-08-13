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
 * 3. A running count is translated into a shoe composition by spreading the
 *    implied removals across every rank in proportion to that rank's shoe
 *    frequency and its tag's deviation from the frequency-weighted mean tag
 *    (see `applyCountToComposition`). Shoe size is held fixed. This is one
 *    reasonable way to collapse a count value into a composition -- it is
 *    NOT the only possible shoe that produces a given running count, since
 *    the same count can arise from many different actual removal histories.
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

/** A counting system's point value ("tag") for each rank. */
export type TagValues = Record<Rank, number>;

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

/** The Ace-Five count: +1 per five seen, -1 per ace seen, every other rank neutral. */
export const ACE_FIVE_TAGS: TagValues = {
	'2': 0,
	'3': 0,
	'4': 0,
	'5': 1,
	'6': 0,
	'7': 0,
	'8': 0,
	'9': 0,
	T: 0,
	A: -1,
};

export interface CalculatorParams {
	decks: number;
	count: number;
	dealerHitsSoft17: boolean;
	tags: TagValues;
}

export const DEFAULT_PARAMS: CalculatorParams = {
	decks: DEFAULT_RULE_SET.decks,
	count: 1,
	dealerHitsSoft17: DEFAULT_RULE_SET.dealerHitsSoft17,
	tags: ACE_FIVE_TAGS,
};

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

	/**
	 * `totCards` is the caller-supplied count of cards remaining in `comp`.
	 * Every recursive step below removes exactly one card, so the count can
	 * be decremented arithmetically as it's threaded down instead of
	 * re-summed from `comp` (an O(rank count) scan) at every node.
	 */
	private dealerDist(
		comp: Composition,
		total: number,
		soft: boolean,
		totCards: number
	): DealerDist {
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
			const sub = this.dealerDist(newComp, newTotal, newSoft, totCards - 1);
			for (const k in sub) {
				res[k] = (res[k] ?? 0) + p * sub[k];
			}
		}

		this.memoDealer.set(key, res);
		return res;
	}

	private standEv(
		comp: Composition,
		playerTotal: number,
		upcard: Rank,
		totCards: number
	): number {
		const startTotal = upcard === 'A' ? 11 : RANK_VALUE[upcard];
		const dist = this.dealerDist(comp, startTotal, upcard === 'A', totCards);
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

	private hitEv(
		comp: Composition,
		total: number,
		soft: boolean,
		upcard: Rank,
		totCards: number
	): number {
		let evHit = 0.0;
		for (const rank of RANKS) {
			const n = comp[RANK_INDEX[rank]];
			if (n <= 0) continue;
			const p = n / totCards;
			const newComp = removeCard(comp, rank);
			const [newTotal, newSoft] = addValue(total, soft, rank);
			evHit += p * this.bestEv(newComp, newTotal, newSoft, upcard, totCards - 1);
		}
		return evHit;
	}

	private bestEv(
		comp: Composition,
		total: number,
		soft: boolean,
		upcard: Rank,
		totCards: number
	): number {
		if (total > 21) return -1.0;

		const key = compKey(comp) + String.fromCharCode(total, soft ? 1 : 0) + upcard;
		const cached = this.memoPlayer.get(key);
		if (cached !== undefined) return cached;

		const evStand = this.standEv(comp, total, upcard, totCards);
		if (total >= 21) {
			this.memoPlayer.set(key, evStand);
			return evStand;
		}

		const evHit = totCards > 0 ? this.hitEv(comp, total, soft, upcard, totCards) : 0.0;

		const best = Math.max(evStand, evHit);
		this.memoPlayer.set(key, best);
		return best;
	}

	/** EV of taking exactly one more card, then being forced to stand, at double the bet. */
	private doubleEv(
		comp: Composition,
		total: number,
		soft: boolean,
		upcard: Rank,
		totCards: number
	): number {
		if (totCards === 0) return this.standEv(comp, total, upcard, totCards) * 2;

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
			ev += p * 2 * this.standEv(newComp, newTotal, upcard, totCards - 1);
		}
		return ev;
	}

	/** Probability that a single hit card busts the player's current total. */
	private playerBustOnHitProb(
		comp: Composition,
		total: number,
		soft: boolean,
		totCards: number
	): number {
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

	private dealerBustProb(comp: Composition, upcard: Rank, totCards: number): number {
		const startTotal = upcard === 'A' ? 11 : RANK_VALUE[upcard];
		const dist = this.dealerDist(comp, startTotal, upcard === 'A', totCards);
		return dist['bust'] ?? 0;
	}

	grid(
		comp0: Composition,
		totals: readonly number[],
		upcards: readonly Rank[],
		soft = false
	): Map<string, number> {
		const out = new Map<string, number>();
		// Every upcard removes exactly one card from the same comp0, so the
		// remaining count after removal is the same for every upcard -- compute
		// it once instead of re-summing per upcard/recursion node.
		const totCardsAfterUpcard = comp0.reduce((sum, n) => sum + n, 0) - 1;
		for (const upcard of upcards) {
			const compUpcard = removeCard(comp0, upcard);
			for (const total of totals) {
				out.set(
					gridKey(total, upcard),
					this.bestEv(compUpcard, total, soft, upcard, totCardsAfterUpcard)
				);
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
		const totCardsAfterUpcard = comp0.reduce((sum, n) => sum + n, 0) - 1;
		for (const upcard of upcards) {
			const compUpcard = removeCard(comp0, upcard);
			const dealerBustPercent =
				this.dealerBustProb(compUpcard, upcard, totCardsAfterUpcard) * 100;
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

				const evStand = this.standEv(compUpcard, total, upcard, totCardsAfterUpcard);
				const evHit = this.hitEv(compUpcard, total, soft, upcard, totCardsAfterUpcard);
				const evDouble = this.doubleEv(
					compUpcard,
					total,
					soft,
					upcard,
					totCardsAfterUpcard
				);

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
					playerBustOnHitPercent:
						this.playerBustOnHitProb(compUpcard, total, soft, totCardsAfterUpcard) * 100,
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
	private splitHandEv(
		comp: Composition,
		rank: Rank,
		upcard: Rank,
		totCards: number
	): number {
		const isAce = rank === 'A';
		const startTotal = RANK_VALUE[rank];
		if (totCards === 0) return this.standEv(comp, startTotal, upcard, totCards);

		let ev = 0.0;
		for (const drawRank of RANKS) {
			const n = comp[RANK_INDEX[drawRank]];
			if (n <= 0) continue;
			const p = n / totCards;
			const newComp = removeCard(comp, drawRank);
			const newTotCards = totCards - 1;
			const [newTotal, newSoft] = addValue(startTotal, isAce, drawRank);

			if (isAce) {
				ev += p * this.standEv(newComp, newTotal, upcard, newTotCards);
				continue;
			}
			const evStand = this.standEv(newComp, newTotal, upcard, newTotCards);
			const evHit = this.hitEv(newComp, newTotal, newSoft, upcard, newTotCards);
			const evDouble = this.doubleEv(newComp, newTotal, newSoft, upcard, newTotCards);
			ev += p * Math.max(evStand, evHit, evDouble);
		}
		return ev;
	}

	private splitEv(comp: Composition, rank: Rank, upcard: Rank, totCards: number): number {
		return 2 * this.splitHandEv(comp, rank, upcard, totCards);
	}

	/** Optimal action (incl. splitting) and EV/bust odds for each pair vs. upcard. */
	analyzeSplitGrid(
		comp0: Composition,
		pairRanks: readonly Rank[],
		upcards: readonly Rank[]
	): Map<string, SplitCellAnalysis> {
		const out = new Map<string, SplitCellAnalysis>();
		const totCardsAfterUpcard = comp0.reduce((sum, n) => sum + n, 0) - 1;
		for (const upcard of upcards) {
			const compUpcard = removeCard(comp0, upcard);
			const dealerBustPercent =
				this.dealerBustProb(compUpcard, upcard, totCardsAfterUpcard) * 100;
			for (const rank of pairRanks) {
				const [total, soft] = pairTotal(rank);
				const evStand = this.standEv(compUpcard, total, upcard, totCardsAfterUpcard);
				const evHit = this.hitEv(compUpcard, total, soft, upcard, totCardsAfterUpcard);
				const evDouble = this.doubleEv(
					compUpcard,
					total,
					soft,
					upcard,
					totCardsAfterUpcard
				);
				const evSplit = this.splitEv(compUpcard, rank, upcard, totCardsAfterUpcard);

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
					playerBustOnHitPercent:
						this.playerBustOnHitProb(compUpcard, total, soft, totCardsAfterUpcard) * 100,
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
 * Rounds a vector of fractional deltas to integers while preserving its sum
 * (largest-remainder method): floor every entry, then hand the leftover
 * units to the entries with the largest fractional parts.
 */
function roundPreservingSum(deltas: readonly number[]): number[] {
	const floors = deltas.map(Math.floor);
	const total = Math.round(deltas.reduce((sum, d) => sum + d, 0));
	let remaining = total - floors.reduce((sum, d) => sum + d, 0);

	const byRemainder = deltas
		.map((delta, index) => ({ index, remainder: delta - Math.floor(delta) }))
		.sort((a, b) => b.remainder - a.remainder);

	for (const { index } of byRemainder) {
		if (remaining <= 0) break;
		floors[index] += 1;
		remaining -= 1;
	}
	return floors;
}

/**
 * Adjusts a composition to represent a given running count under an
 * arbitrary counting system.
 *
 * The count value `N` is spread across every rank at once: each rank is
 * shifted in proportion to how many of it the shoe holds (`w_r`) and to how
 * far its tag sits from the frequency-weighted mean tag (`t̄`), i.e.
 * `d_r = -λ · w_r · (t_r - t̄)` in real cards, with `λ` picked so the
 * removals really do produce a running count of `N`. Subtracting `t̄` keeps
 * the shoe size fixed (`Σ d_r = 0`) and makes unbalanced systems read their
 * count relative to the system's own pivot.
 *
 * For the Ace-Five tags this reduces exactly to the original special case:
 * `N/2` fewer real fives and `N/2` more real aces, whatever the deck count.
 *
 * Deltas are computed in half-card units and rounded to integers with
 * `roundPreservingSum` (rank counts index a char-code memo key, so they must
 * stay whole); the residual is under half a half-card per rank.
 */
export function applyCountToComposition(
	comp: Composition,
	tags: TagValues,
	count: number
): Composition {
	const weights = comp.map((halfCards) => halfCards / 2);
	const totalCards = weights.reduce((sum, w) => sum + w, 0);
	const meanTag =
		weights.reduce((sum, w, index) => sum + w * tags[RANKS[index]], 0) / totalCards;

	// Σ w_r · t_r · (t_r - t̄) -- the frequency-weighted variance of the tags,
	// i.e. how much counting information the system carries per shoe.
	const spread = weights.reduce(
		(sum, w, index) => sum + w * tags[RANKS[index]] * (tags[RANKS[index]] - meanTag),
		0
	);
	if (Math.abs(spread) < 1e-9) {
		if (count === 0) return comp.slice();
		throw new Error('Tag values give the count no effect (all ranks weighted equally).');
	}

	const lambda = count / spread;
	const halfCardDeltas = weights.map(
		(w, index) => -2 * lambda * w * (tags[RANKS[index]] - meanTag)
	);

	const next = comp.slice();
	const rounded = roundPreservingSum(halfCardDeltas);
	for (let index = 0; index < next.length; index += 1) {
		next[index] += rounded[index];
		if (next[index] < 0) {
			throw new Error('Count too extreme for this shoe size (negative card count).');
		}
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
	tags: TagValues = ACE_FIVE_TAGS,
	totals: readonly number[] = HARD_TOTALS,
	upcards: readonly Rank[] = RANKS,
	soft = false
): EvComparisonResult {
	const base = baseComposition(ruleSet);
	const modified = applyCountToComposition(base, tags, Math.round(count));
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
	tags: TagValues = ACE_FIVE_TAGS,
	pairRanks: readonly Rank[] = PAIR_RANKS,
	upcards: readonly Rank[] = RANKS
): SplitEvComparisonResult {
	const base = baseComposition(ruleSet);
	const modified = applyCountToComposition(base, tags, Math.round(count));
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
	count: number,
	tags: TagValues = ACE_FIVE_TAGS
): {
	hard: EvComparisonResult;
	soft: EvComparisonResult;
	split: SplitEvComparisonResult;
} {
	const base = baseComposition(ruleSet);
	const modified = applyCountToComposition(base, tags, Math.round(count));
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
