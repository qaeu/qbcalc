/**
 * Splitting a pair: the draw enumeration for one post-split hand, and the resplit
 * ladder climbed over hand allowances. See docs/ev-model.md §The split budget.
 */

import {
	ACE_INDEX,
	addPacked as sharedAddPacked,
	CARD_UNITS as sharedCardUnits,
	KEY_MULT as sharedKeyMult,
	RANK_VALUE,
	RANKS,
} from './cards';
import type { DealerModel } from './dealer';
import {
	addOutcome,
	outcomeFromEv,
	scaleOutcome,
	ZERO_OUTCOME,
	type Outcome,
} from './outcome';
import type { PlayerModel } from './player';
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

/** One hand's (or one allowance's) worth: EV across every hand it becomes, odds for one of them. */
interface HandAnalysis {
	ev: number;
	outcome: Outcome;
}

export class SplitModel {
	private readonly comp: Int32Array;
	private readonly dealer: DealerModel;
	private readonly player: PlayerModel;
	private readonly das: boolean;
	private readonly splitLimit: number;
	private readonly resplitAces: boolean;
	private readonly hitSplitAces: boolean;

	constructor(shoe: Shoe, dealer: DealerModel, player: PlayerModel, ruleSet: RuleSet) {
		this.comp = shoe.comp;
		this.dealer = dealer;
		this.player = player;
		this.das = ruleSet.doubleAfterSplit;
		this.splitLimit = ruleSet.splitLimit;
		this.resplitAces = ruleSet.resplitAces;
		this.hitSplitAces = ruleSet.hitSplitAces;
	}

	/**
	 * EV of splitting a pair: two hands at one unit each, each starting from a
	 * single card of `rankIndex` plus a mandatory second card, then played
	 * optimally. Doubling is offered only when the table allows it after a split;
	 * split aces follow the common one-card-per-hand, must-stand rule unless
	 * `hitSplitAces` lets them be drawn to like any other hand.
	 */
	analyse(
		rankIndex: number,
		upcardIndex: number,
		totCards: number,
		key: number
	): HandAnalysis {
		const isAce = rankIndex === ACE_INDEX;
		const startTotal = RANK_VALUE[rankIndex];
		if (totCards < CARD_UNITS) {
			const ev = this.dealer.standEv(startTotal, upcardIndex, totCards, key);
			const push = this.dealer.standPush(startTotal, upcardIndex, totCards, key);
			return { ev: 2 * ev, outcome: outcomeFromEv(ev, push) };
		}

		const comp = this.comp;
		const subTotCards = totCards - CARD_UNITS;
		const drawProbs: number[] = [];
		const drawPlayEvs: number[] = [];
		const drawOutcomes: Outcome[] = [];
		const drawPairsUp: boolean[] = [];
		for (let index = 0; index < RANK_COUNT; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const packed = addPacked(startTotal, isAce, index);
			const newTotal = packed >> 1;
			const newSoft = (packed & 1) === 1;
			const drawKey = key + KEY_MULT[index];
			comp[index] = n - CARD_UNITS;

			// Written as a running maximum rather than one `Math.max` so the
			// settlement odds of the branch actually taken can be picked up alongside
			// its EV -- and so the push probability behind a branch that loses the
			// comparison is never computed at all.
			let playEv = this.dealer.standEv(newTotal, upcardIndex, subTotCards, drawKey);
			let playOutcome = outcomeFromEv(
				playEv,
				this.dealer.standPush(newTotal, upcardIndex, subTotCards, drawKey)
			);
			// A split ace takes exactly one card and must stand on it, unless the
			// table lets it be drawn to like any other hand.
			const oneCardOnly = isAce && !this.hitSplitAces;
			if (!oneCardOnly) {
				const evHit = this.player.hitEv(
					newTotal,
					newSoft,
					upcardIndex,
					subTotCards,
					drawKey
				);
				if (evHit > playEv) {
					playEv = evHit;
					playOutcome = outcomeFromEv(
						evHit,
						this.player.hitPush(newTotal, newSoft, upcardIndex, subTotCards, drawKey)
					);
				}
				if (this.das) {
					const evDouble = this.player.doubleEv(
						newTotal,
						newSoft,
						upcardIndex,
						subTotCards,
						drawKey
					);
					if (evDouble > playEv) {
						playEv = evDouble;
						playOutcome = outcomeFromEv(
							evDouble,
							this.player.doublePush(
								newTotal,
								newSoft,
								upcardIndex,
								subTotCards,
								drawKey
							),
							2
						);
					}
				}
			}

			comp[index] = n;
			drawProbs.push(n / totCards);
			drawPlayEvs.push(playEv);
			drawOutcomes.push(playOutcome);
			drawPairsUp.push(index === rankIndex);
		}

		let noResplitEv = 0;
		let noResplitOutcome = ZERO_OUTCOME;
		for (let draw = 0; draw < drawProbs.length; draw += 1) {
			noResplitEv += drawProbs[draw] * drawPlayEvs[draw];
			noResplitOutcome = addOutcome(
				noResplitOutcome,
				scaleOutcome(drawOutcomes[draw], drawProbs[draw])
			);
		}
		const noResplit = { ev: noResplitEv, outcome: noResplitOutcome };
		const canResplit = !isAce || this.resplitAces;
		const byAllowance = new Map<number, HandAnalysis>();

		/** One post-split hand that may occupy at most `hands` hand slots. */
		const handAnalysis = (hands: number): HandAnalysis => {
			if (hands < 2 || !canResplit) return noResplit;
			const cached = byAllowance.get(hands);
			if (cached !== undefined) return cached;

			// Splitting again trades this one hand for two, which divide this hand's
			// own allowance between them.
			const first = handAnalysis(Math.ceil(hands / 2));
			const second = handAnalysis(Math.floor(hands / 2));
			const evResplit = first.ev + second.ev;
			const outcomeResplit = scaleOutcome(addOutcome(first.outcome, second.outcome), 0.5);

			let ev = 0;
			let outcome = ZERO_OUTCOME;
			for (let draw = 0; draw < drawProbs.length; draw += 1) {
				const resplits = drawPairsUp[draw] && evResplit > drawPlayEvs[draw];
				ev += drawProbs[draw] * (resplits ? evResplit : drawPlayEvs[draw]);
				outcome = addOutcome(
					outcome,
					scaleOutcome(resplits ? outcomeResplit : drawOutcomes[draw], drawProbs[draw])
				);
			}

			const analysis = { ev, outcome };
			byAllowance.set(hands, analysis);
			return analysis;
		};

		const first = handAnalysis(Math.ceil(this.splitLimit / 2));
		const second = handAnalysis(Math.floor(this.splitLimit / 2));
		return {
			ev: first.ev + second.ev,
			outcome: scaleOutcome(addOutcome(first.outcome, second.outcome), 0.5),
		};
	}
}
