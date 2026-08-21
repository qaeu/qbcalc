/**
 * The dealer's side of the table: the exact final-hand distribution reached by
 * recursive enumeration, and the stand-EV lookup table collapsed out of it.
 *
 * See docs/ev-model.md §Performance notes for the arena and the stand table, and
 * §The dealer's natural for the peek conditioning.
 */

import {
	ACE_INDEX,
	addPacked as sharedAddPacked,
	blackjackHoleRank,
	CARD_UNITS as sharedCardUnits,
	KEY_MULT as sharedKeyMult,
	RANK_INDEX,
	RANK_VALUE,
	RANKS,
	type Rank,
} from './cards';
import { FAST_PRECISION, type Precision } from './precision';
import type { RuleSet } from './rules';
import type { Shoe } from './shoe';

/**
 * Hot-path rebindings of the shared card primitives.
 *
 * Vite's SSR transform -- which vitest runs this source through unbundled --
 * turns a cross-module reference into a property load on the importing
 * namespace, and the draw loops below would pay that on every iteration.
 * Binding them once at module scope keeps an unbundled run as fast as a bundled
 * one; without it the engine's test suite takes ~60% longer. Rollup hoists these
 * away, so the production build is unaffected either way.
 */
const addPacked = sharedAddPacked;
const CARD_UNITS = sharedCardUnits;
const KEY_MULT = sharedKeyMult;
const RANK_COUNT = RANKS.length;

/**
 * A dealer's final-outcome distribution: probability by slot, where slot 0 is a
 * two-card natural, slot 22 is a bust, and slots 4-21 are made totals. Outcomes
 * below 17 are only reachable by a dealer forced to stand on a stiff hand because
 * the shoe ran out, but they are represented exactly all the same.
 */
type Dist = Float64Array;
const NATURAL = 0;
const BUST = 22;
const DIST_LEN = 23;

/**
 * Stand EV indexed by the player's total, with the dealer's bust probability in
 * the otherwise impossible slot 0. It runs past 21 so that a caller asking about a
 * total no real hand can hold still gets the comparison it asked for.
 */
const TABLE_LEN = 31;
/** The stand table's second half: the chance the dealer ties `total`, at `PUSH_OFFSET + total`. */
const PUSH_OFFSET = TABLE_LEN;

/** Where `standTable` parks the dealer's bust probability -- no player holds a 0. */
const BUST_SLOT = 0;

/**
 * Dealer distributions live in one growable arena instead of being individual
 * arrays. A distribution is addressed by an integer id and occupies `DIST_LEN`
 * slots starting at `id * DIST_LEN`; `lo[id]` is the lowest slot it has any mass
 * in, so the accumulation loop can skip the rest.
 */
class DistArena {
	private data = new Float64Array(DIST_LEN * 4096);
	private lo = new Int32Array(4096);
	private size = 0;

	get slots(): Float64Array {
		return this.data;
	}

	lowest(id: number): number {
		return this.lo[id];
	}

	alloc(lowest: number): number {
		if ((this.size + 1) * DIST_LEN > this.data.length) {
			const grownData = new Float64Array(this.data.length * 2);
			grownData.set(this.data);
			this.data = grownData;
			const grownLo = new Int32Array(this.lo.length * 2);
			grownLo.set(this.lo);
			this.lo = grownLo;
		}
		const id = this.size;
		this.size += 1;
		this.lo[id] = lowest;
		return id;
	}

	reset(): void {
		this.data.fill(0);
		this.size = 0;
	}
}

export class DealerModel {
	private readonly comp: Int32Array;
	private readonly h17: boolean;
	private readonly peek: boolean;
	/** Draws past this depth leave the shoe alone -- see docs/ev-model.md §Precision modes. */
	private readonly drawCap: number;
	private readonly arena = new DistArena();
	/** Distributions for a dealer who is already finished, allocated once. */
	private readonly terminal = new Int32Array(DIST_LEN);
	/** memoDealer[total * 2 + soft]: removal key -> distribution id. */
	private readonly memoDealer: Map<number, number>[] = Array.from(
		{ length: 64 },
		() => new Map()
	);
	/** memoStand[upcard]: removal key -> stand EV by player total. */
	private readonly memoStand: Map<number, Float64Array>[] = Array.from(
		{ length: RANK_COUNT },
		() => new Map()
	);

	constructor(shoe: Shoe, ruleSet: RuleSet, precision: Precision = FAST_PRECISION) {
		this.comp = shoe.comp;
		this.h17 = ruleSet.dealerHitsSoft17;
		this.peek = ruleSet.dealerPeek;
		this.drawCap = precision.drawCap;
		this.allocTerminals();
	}

	/** Drops everything memoised against a root composition that has been replaced. */
	clear(): void {
		for (const memo of this.memoDealer) memo.clear();
		for (const memo of this.memoStand) memo.clear();
		this.arena.reset();
		this.allocTerminals();
	}

	/** A dealer standing on `total`, and (in slot `BUST`) one who has busted. */
	private allocTerminals(): void {
		for (let total = 0; total < DIST_LEN; total += 1) {
			const id = this.arena.alloc(total);
			this.arena.slots[id * DIST_LEN + total] = 1;
			this.terminal[total] = id;
		}
	}

	/**
	 * The dealer's final-outcome distribution, as an arena id.
	 *
	 * `totCards` is the caller-supplied count of half-card units remaining in the
	 * shoe, i.e. it always equals its sum; every recursive step removes exactly one
	 * card, so it is decremented arithmetically on the way down instead of being
	 * re-summed at every node. `key` is threaded down the same way.
	 *
	 * `depth` counts the dealer's own draws, from 0 at the upcard. Once it reaches
	 * `drawCap` the shoe freezes: the draw is still taken and priced, but nothing is
	 * removed for it, so `comp`, `totCards` and `key` all stay where they were. That
	 * keeps `(comp, totCards)` an exact function of `key` either side of the
	 * boundary, which is what makes the memos safe -- see docs/ev-model.md
	 * §Precision modes.
	 */
	dealerDist(
		total: number,
		soft: boolean,
		totCards: number,
		key: number,
		depth = 0
	): number {
		if (total > 21) return this.terminal[BUST];
		const stands = total >= 18 || (total === 17 && (!soft || !this.h17));
		if (stands) return this.terminal[total];
		// Nothing left to draw: the dealer is stuck on a stiff total.
		if (totCards < CARD_UNITS) return this.terminal[total];

		const memo = this.memoDealer[total * 2 + (soft ? 1 : 0)];
		const cached = memo.get(key);
		if (cached !== undefined) return cached;

		const comp = this.comp;
		const frozen = depth >= this.drawCap;
		const subTotCards = frozen ? totCards : totCards - CARD_UNITS;
		const children: number[] = [];
		const probabilities: number[] = [];
		let lowest = BUST;
		for (let index = 0; index < RANK_COUNT; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const packed = addPacked(total, soft, index);
			if (!frozen) comp[index] = n - CARD_UNITS;
			const child = this.dealerDist(
				packed >> 1,
				(packed & 1) === 1,
				subTotCards,
				frozen ? key : key + KEY_MULT[index],
				depth + 1
			);
			if (!frozen) comp[index] = n;
			children.push(child);
			probabilities.push(n / totCards);
			if (this.arena.lowest(child) < lowest) lowest = this.arena.lowest(child);
		}

		// Allocated only once the children are in hand: the arena can move its
		// backing store while they are being computed.
		const id = this.arena.alloc(lowest);
		const slots = this.arena.slots;
		const at = id * DIST_LEN;
		for (let child = 0; child < children.length; child += 1) {
			const p = probabilities[child];
			const from = children[child] * DIST_LEN;
			for (let slot = lowest; slot < DIST_LEN; slot += 1) {
				slots[at + slot] += p * slots[from + slot];
			}
		}

		memo.set(key, id);
		return id;
	}

	/**
	 * The dealer's final-hand distribution from an upcard alone, as a standalone
	 * vector rather than an arena id: it is built once per (composition, upcard)
	 * and consumed immediately by `standTable`, so it is off the hot path.
	 *
	 * A peeking dealer's ten or ace upcard is conditioned on having missed the
	 * natural by enumerating the hole card explicitly and renormalising; without
	 * the peek the natural is tracked as its own `NATURAL` outcome. See
	 * docs/ev-model.md §The dealer's natural.
	 */
	private upcardDist(upcardIndex: number, totCards: number, key: number): Dist {
		const upcard = RANKS[upcardIndex];
		const startTotal = RANK_VALUE[upcardIndex];
		const startSoft = upcardIndex === ACE_INDEX;
		const holeRank = blackjackHoleRank(upcard);
		if (holeRank === null) {
			const id = this.dealerDist(startTotal, startSoft, totCards, key);
			return this.arena.slots.slice(id * DIST_LEN, id * DIST_LEN + DIST_LEN);
		}

		const comp = this.comp;
		const holeIndex = RANK_INDEX[holeRank];
		const naturalCards = comp[holeIndex];
		const nonNaturalCards = totCards - naturalCards;
		// A shoe holding nothing but the blackjack-completing rank leaves no hand
		// to condition on: the hole card is guaranteed to be it.
		if (nonNaturalCards < CARD_UNITS) {
			const res = new Float64Array(DIST_LEN);
			res[this.peek ? 21 : NATURAL] = 1;
			return res;
		}

		const nonNatural = new Float64Array(DIST_LEN);
		const subTotCards = totCards - CARD_UNITS;
		for (let index = 0; index < RANK_COUNT; index += 1) {
			if (index === holeIndex) continue;
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const p = n / nonNaturalCards;
			const packed = addPacked(startTotal, startSoft, index);
			comp[index] = n - CARD_UNITS;
			// Depth 1, not 0: this loop has already taken the hole card off the shoe
			// outside `dealerDist`'s own counter, so a peeking and a non-peeking dealer
			// would otherwise freeze at different card counts.
			const child = this.dealerDist(
				packed >> 1,
				(packed & 1) === 1,
				subTotCards,
				key + KEY_MULT[index],
				1
			);
			comp[index] = n;
			const from = child * DIST_LEN;
			for (let slot = 4; slot < DIST_LEN; slot += 1) {
				nonNatural[slot] += p * this.arena.slots[from + slot];
			}
		}

		// The dealer has already checked and confirmed no natural -- the hand being
		// played only exists in this natural-free world.
		if (this.peek) return nonNatural;

		const pNatural = naturalCards / totCards;
		const res = new Float64Array(DIST_LEN);
		res[NATURAL] = pNatural;
		for (let slot = 4; slot < DIST_LEN; slot += 1) {
			res[slot] = (1 - pNatural) * nonNatural[slot];
		}
		return res;
	}

	/**
	 * Stand EV against `upcard` for every player total at once, with the dealer's
	 * bust probability in slot `BUST_SLOT` and its tie probabilities in the half
	 * above `PUSH_OFFSET`.
	 */
	private standTable(upcardIndex: number, totCards: number, key: number): Float64Array {
		const memo = this.memoStand[upcardIndex];
		const cached = memo.get(key);
		if (cached !== undefined) return cached;

		const dist = this.upcardDist(upcardIndex, totCards, key);
		const table = new Float64Array(TABLE_LEN * 2);
		table[BUST_SLOT] = dist[BUST];
		let made = 0;
		for (let total = 4; total <= 21; total += 1) made += dist[total];
		let below = 0;
		for (let total = 4; total < TABLE_LEN; total += 1) {
			const tie = total <= 21 ? dist[total] : 0;
			// A dealer bust pays; a genuine two-card blackjack beats any hand these
			// tables can show, even one that also lands on 21 by drawing.
			table[total] = dist[BUST] - dist[NATURAL] + below - (made - below - tie);
			table[PUSH_OFFSET + total] = tie;
			below += tie;
		}
		memo.set(key, table);
		return table;
	}

	standEv(
		playerTotal: number,
		upcardIndex: number,
		totCards: number,
		key: number
	): number {
		return this.standTable(upcardIndex, totCards, key)[playerTotal];
	}

	/** Chance the dealer finishes on exactly `playerTotal`, i.e. a stood hand pushes. */
	standPush(
		playerTotal: number,
		upcardIndex: number,
		totCards: number,
		key: number
	): number {
		return this.standTable(upcardIndex, totCards, key)[PUSH_OFFSET + playerTotal];
	}

	bustProb(upcardIndex: number, totCards: number, key: number): number {
		return this.standTable(upcardIndex, totCards, key)[BUST_SLOT];
	}

	/** Chance the hole card makes a dealer natural, before any peek. */
	blackjackProb(upcard: Rank, totCards: number): number {
		const holeRank = blackjackHoleRank(upcard);
		if (holeRank === null || totCards < CARD_UNITS) return 0;
		return this.comp[RANK_INDEX[holeRank]] / totCards;
	}
}
