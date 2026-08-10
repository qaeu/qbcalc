/**
 * Composition-dependent blackjack EV calculator.
 *
 * Computes exact optimal-action EV (stand vs. hit, hard totals only) for each
 * hard total against each dealer upcard, for a full shoe and for a shoe
 * adjusted to simulate a given Ace-Five running count, then reports the
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
 * 1. The player's own two cards are NOT removed from the shoe composition.
 *    Only the dealer's upcard is removed before computing dealer/player EV.
 *    This isolates the primary count effect (ten/five/ace density driving
 *    dealer bust and dealer-completion probabilities) while skipping the
 *    second-order effect of exactly which two cards the player is holding.
 * 2. This table only captures the *playing-decision* channel of the count.
 *    It does NOT include the extra 3:2 payout from more player blackjacks
 *    at the deal -- that only matters at the two-card stage, which is
 *    outside the scope of a "hard totals 8-17" hit/stand table.
 * 3. The Ace-Five running count is translated into a shoe composition by
 *    assuming the count value N was produced by removing exactly N/2 more
 *    fives than aces from a fresh shoe, split evenly: five-count -= N/2,
 *    ace-count += N/2 (real-card units). This is one reasonable way to
 *    collapse a count value into a composition -- it is NOT the only
 *    possible shoe that produces a given running count, since the same
 *    count can arise from many different actual removal histories.
 */

export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'A';

export interface RuleSet {
	decks: number;
	dealerHitsSoft17: boolean;
}

/** Shoe composition in half-card units, indexed by RANK_INDEX. */
export type Composition = readonly number[];

export interface EvComparisonRow {
	total: number;
	upcard: Rank;
	baseEvPercent: number;
	countEvPercent: number;
	deltaPercentPoints: number;
}

export interface EvComparisonResult {
	totals: readonly number[];
	upcards: readonly Rank[];
	rows: readonly EvComparisonRow[];
}

export const RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
export const HARD_TOTALS: readonly number[] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
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
		let evHit = 0.0;
		if (totCards > 0) {
			for (const rank of RANKS) {
				const n = comp[RANK_INDEX[rank]];
				if (n <= 0) continue;
				const p = n / totCards;
				const newComp = removeCard(comp, rank);
				const [newTotal, newSoft] = addValue(total, soft, rank);
				evHit += p * this.bestEv(newComp, newTotal, newSoft, upcard);
			}
		}

		const best = Math.max(evStand, evHit);
		this.memoPlayer.set(key, best);
		return best;
	}

	grid(
		comp0: Composition,
		totals: readonly number[],
		upcards: readonly Rank[]
	): Map<string, number> {
		const out = new Map<string, number>();
		for (const upcard of upcards) {
			const compUpcard = removeCard(comp0, upcard);
			for (const total of totals) {
				out.set(gridKey(total, upcard), this.bestEv(compUpcard, total, false, upcard));
			}
		}
		return out;
	}
}

function gridKey(total: number, upcard: Rank): string {
	return `${total}-${upcard}`;
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

export function computeEvComparison(
	ruleSet: RuleSet,
	count: number,
	totals: readonly number[] = HARD_TOTALS,
	upcards: readonly Rank[] = RANKS
): EvComparisonResult {
	const base = baseComposition(ruleSet);
	const modified = applyAceFiveCount(base, Math.round(count));

	const baseGrid = new ShoeEv(ruleSet).grid(base, totals, upcards);
	const modGrid = new ShoeEv(ruleSet).grid(modified, totals, upcards);

	const rows: EvComparisonRow[] = [];
	for (const upcard of upcards) {
		for (const total of totals) {
			const key = gridKey(total, upcard);
			const baseEvPercent = (baseGrid.get(key) ?? 0) * 100;
			const countEvPercent = (modGrid.get(key) ?? 0) * 100;
			rows.push({
				total,
				upcard,
				baseEvPercent,
				countEvPercent,
				deltaPercentPoints: countEvPercent - baseEvPercent,
			});
		}
	}

	return { totals, upcards, rows };
}
