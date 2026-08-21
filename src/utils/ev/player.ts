/**
 * The player's side of the table: what a hand is worth taking each action, and the
 * push probability behind each of those EVs.
 */

import {
	addPacked as sharedAddPacked,
	CARD_UNITS as sharedCardUnits,
	KEY_MULT as sharedKeyMult,
	RANKS,
	type Rank,
} from './cards';
import type { DealerModel } from './dealer';
import { FAST_PRECISION, type Precision } from './precision';
import type { RuleSet, Surrender } from './rules';
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

/** The EV of surrendering: half the wager back, whatever the hand. */
const SURRENDER_EV = -0.5;

export class PlayerModel {
	private readonly comp: Int32Array;
	private readonly dealer: DealerModel;
	private readonly peek: boolean;
	private readonly surrender: Surrender;
	/**
	 * Draws past this depth leave the shoe alone. Depth is this hand's own, counted
	 * from its first draw -- the dealer's recursion keeps its own count. See
	 * docs/ev-model.md §Precision modes.
	 */
	private readonly drawCap: number;
	/** memoPlayer[(total * 2 + soft) * 10 + upcard]: removal key -> best EV. */
	private readonly memoPlayer: Map<number, number>[] = Array.from(
		{ length: 64 * RANK_COUNT },
		() => new Map()
	);
	/** The same, for `bestPush` -- keyed identically, filled only where a breakdown asks. */
	private readonly memoPush: Map<number, number>[] = Array.from(
		{ length: 64 * RANK_COUNT },
		() => new Map()
	);

	constructor(
		shoe: Shoe,
		dealer: DealerModel,
		ruleSet: RuleSet,
		precision: Precision = FAST_PRECISION
	) {
		this.comp = shoe.comp;
		this.dealer = dealer;
		this.peek = ruleSet.dealerPeek;
		this.surrender = ruleSet.surrender;
		this.drawCap = precision.drawCap;
	}

	/** Drops everything memoised against a root composition that has been replaced. */
	clear(): void {
		for (const memo of this.memoPlayer) memo.clear();
		for (const memo of this.memoPush) memo.clear();
	}

	hitEv(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number,
		depth = 0
	): number {
		const comp = this.comp;
		const frozen = depth >= this.drawCap;
		const subTotCards = frozen ? totCards : totCards - CARD_UNITS;
		let evHit = 0.0;
		for (let index = 0; index < RANK_COUNT; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const p = n / totCards;
			const packed = addPacked(total, soft, index);
			if (!frozen) comp[index] = n - CARD_UNITS;
			evHit +=
				p
				* this.bestEv(
					packed >> 1,
					(packed & 1) === 1,
					upcardIndex,
					subTotCards,
					frozen ? key : key + KEY_MULT[index],
					depth + 1
				);
			if (!frozen) comp[index] = n;
		}
		return evHit;
	}

	bestEv(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number,
		depth = 0
	): number {
		if (total > 21) return -1.0;

		const memo = this.memoPlayer[(total * 2 + (soft ? 1 : 0)) * RANK_COUNT + upcardIndex];
		const cached = memo.get(key);
		if (cached !== undefined) return cached;

		const evStand = this.dealer.standEv(total, upcardIndex, totCards, key);
		if (total >= 21) {
			memo.set(key, evStand);
			return evStand;
		}

		const evHit =
			totCards >= CARD_UNITS ?
				this.hitEv(total, soft, upcardIndex, totCards, key, depth)
			:	0.0;

		const best = Math.max(evStand, evHit);
		memo.set(key, best);
		return best;
	}

	/**
	 * Chance a hand played out the way `bestEv` plays it ends in a push. It shadows
	 * `bestEv` rather than being folded into it, reading which branch was taken
	 * back off that memo -- see docs/ev-model.md §Performance notes.
	 */
	bestPush(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number,
		depth = 0
	): number {
		// A busted hand is a loss, never a push.
		if (total > 21) return 0;

		const memo = this.memoPush[(total * 2 + (soft ? 1 : 0)) * RANK_COUNT + upcardIndex];
		const cached = memo.get(key);
		if (cached !== undefined) return cached;

		const evStand = this.dealer.standEv(total, upcardIndex, totCards, key);
		const best = this.bestEv(total, soft, upcardIndex, totCards, key, depth);
		// A hand only stands where standing is at least as good, so a best EV
		// strictly above the stand EV is one that hit.
		const push =
			best > evStand ?
				this.hitPush(total, soft, upcardIndex, totCards, key, depth)
			:	this.dealer.standPush(total, upcardIndex, totCards, key);

		memo.set(key, push);
		return push;
	}

	/** `hitEv`'s push counterpart: take one card, then play on optimally. */
	hitPush(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number,
		depth = 0
	): number {
		const comp = this.comp;
		const frozen = depth >= this.drawCap;
		const subTotCards = frozen ? totCards : totCards - CARD_UNITS;
		let push = 0.0;
		for (let index = 0; index < RANK_COUNT; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const p = n / totCards;
			const packed = addPacked(total, soft, index);
			if (!frozen) comp[index] = n - CARD_UNITS;
			push +=
				p
				* this.bestPush(
					packed >> 1,
					(packed & 1) === 1,
					upcardIndex,
					subTotCards,
					frozen ? key : key + KEY_MULT[index],
					depth + 1
				);
			if (!frozen) comp[index] = n;
		}
		return push;
	}

	/** EV of taking exactly one more card, then being forced to stand, at double the bet. */
	doubleEv(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number,
		depth = 0
	): number {
		if (totCards < CARD_UNITS) {
			return this.dealer.standEv(total, upcardIndex, totCards, key) * 2;
		}

		const comp = this.comp;
		const frozen = depth >= this.drawCap;
		const subTotCards = frozen ? totCards : totCards - CARD_UNITS;
		let ev = 0.0;
		for (let index = 0; index < RANK_COUNT; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const p = n / totCards;
			const newTotal = addPacked(total, soft, index) >> 1;
			if (newTotal > 21) {
				ev += p * -2;
				continue;
			}
			if (!frozen) comp[index] = n - CARD_UNITS;
			ev +=
				p
				* 2
				* this.dealer.standEv(
					newTotal,
					upcardIndex,
					subTotCards,
					frozen ? key : key + KEY_MULT[index]
				);
			if (!frozen) comp[index] = n;
		}
		return ev;
	}

	/** `doubleEv`'s push counterpart: the one card drawn has to land on the dealer's total. */
	doublePush(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number,
		depth = 0
	): number {
		if (totCards < CARD_UNITS) {
			return this.dealer.standPush(total, upcardIndex, totCards, key);
		}

		const comp = this.comp;
		const frozen = depth >= this.drawCap;
		const subTotCards = frozen ? totCards : totCards - CARD_UNITS;
		let push = 0.0;
		for (let index = 0; index < RANK_COUNT; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const newTotal = addPacked(total, soft, index) >> 1;
			// A busted double is a loss outright, so it contributes no push.
			if (newTotal > 21) continue;
			if (!frozen) comp[index] = n - CARD_UNITS;
			push +=
				(n / totCards)
				* this.dealer.standPush(
					newTotal,
					upcardIndex,
					subTotCards,
					frozen ? key : key + KEY_MULT[index]
				);
			if (!frozen) comp[index] = n;
		}
		return push;
	}

	/** Probability that a single hit card busts the player's current total. */
	bustOnHitProb(total: number, soft: boolean, totCards: number): number {
		if (totCards < CARD_UNITS) return 0;

		const comp = this.comp;
		let bustP = 0.0;
		for (let index = 0; index < RANK_COUNT; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			if (addPacked(total, soft, index) >> 1 > 21) bustP += n / totCards;
		}
		return bustP;
	}

	/**
	 * What giving the hand up is worth, or null at a table (or against an upcard)
	 * that doesn't offer it. The value comes back in the *same frame* as the play
	 * EVs it is compared against and displayed beside, which is what the rebasing
	 * below is for -- see docs/ev-model.md §Surrender frames.
	 */
	surrenderEv(upcard: Rank, totCards: number): number | null {
		if (this.surrender === 'none') return null;
		// 'es10' is offered against a ten and nothing else -- not late against the
		// rest of the row, simply absent there.
		if (this.surrender === 'es10' && upcard !== 'T') return null;
		// No hole card to be late to, and no peek to condition on: half the stake,
		// in the unconditional frame every other no-peek cell is reported in.
		if (!this.peek) return SURRENDER_EV;
		// Late surrender behind a peek: both sides already live in the same
		// no-dealer-blackjack world.
		if (this.surrender === 'late') return SURRENDER_EV;

		// Early surrender dodges the natural, so its true value is pre-peek; rebase
		// it into the post-peek frame its neighbours are reported in.
		const pBlackjack = this.dealer.blackjackProb(upcard, totCards);
		// A shoe that can only make a natural leaves no conditional world to rebase
		// into; the pre-peek value is all there is.
		if (pBlackjack >= 1) return SURRENDER_EV;
		return (SURRENDER_EV + pBlackjack) / (1 - pBlackjack);
	}
}
