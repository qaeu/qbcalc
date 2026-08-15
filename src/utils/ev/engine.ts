/**
 * The engine that walks one shoe composition: it prices every action a hand may
 * take, picks the best, and fills the three analysis grids from that.
 */

import { CARD_UNITS, KEY_MULT, pairTotal, RANK_INDEX, RANKS, type Rank } from './cards';
import { type Composition } from './composition';
import { DealerModel } from './dealer';
import {
	bestAction,
	outcomeFromEv,
	outcomePercent,
	type ActionAnalysis,
} from './outcome';
import { PlayerModel } from './player';
import {
	HARD_TOTALS,
	PAIR_RANKS,
	SOFT_TOTALS,
	type PlayerAction,
	type RuleSet,
} from './rules';
import { Shoe } from './shoe';
import { SplitModel } from './split';

/** Fields an EV table cell needs, before it is paired with its counterpart. */
export interface CellAnalysis {
	evPercent: number;
	optimalAction: PlayerAction;
	playerBustOnHitPercent: number;
	dealerBustPercent: number;
	actions: readonly ActionAnalysis[];
}

/**
 * The three analysis grids one shoe composition yields, keyed by `gridKey` /
 * `splitGridKey`. A comparison table is two of these read side by side.
 */
export interface EvGrids {
	hard: Map<string, CellAnalysis>;
	soft: Map<string, CellAnalysis>;
	split: Map<string, CellAnalysis>;
}

export function gridKey(total: number, upcard: Rank): string {
	return `${total}-${upcard}`;
}

export function splitGridKey(rank: Rank, upcard: Rank): string {
	return `${rank}-${upcard}`;
}

/**
 * One engine walks one shoe composition, holding the models that share its shoe.
 * Its memos are keyed on removals from whichever root composition it was last
 * handed, so a new root drops them all.
 */
export class ShoeEv {
	private readonly shoe = new Shoe();
	private readonly dealer: DealerModel;
	private readonly player: PlayerModel;
	private readonly split: SplitModel;
	private readonly splitLimit: number;

	constructor(ruleSet: RuleSet) {
		this.dealer = new DealerModel(this.shoe, ruleSet);
		this.player = new PlayerModel(this.shoe, this.dealer, ruleSet);
		this.split = new SplitModel(this.shoe, this.dealer, this.player, ruleSet);
		this.splitLimit = ruleSet.splitLimit;
	}

	private setRoot(comp0: Composition): void {
		if (!this.shoe.setRoot(comp0)) return;
		this.dealer.clear();
		this.player.clear();
	}

	/**
	 * One action's price, in the form the drill-down dialog reads. Each of these
	 * pairs the EV the grid already compares against with the settlement odds
	 * behind it, so a cell's headline number and its breakdown can never disagree
	 * about what an action is worth.
	 */
	private standAction(
		total: number,
		upcardIndex: number,
		totCards: number,
		key: number
	): ActionAnalysis {
		const ev = this.dealer.standEv(total, upcardIndex, totCards, key);
		const push = this.dealer.standPush(total, upcardIndex, totCards, key);
		return {
			action: 'S',
			evPercent: ev * 100,
			outcome: outcomePercent(outcomeFromEv(ev, push)),
		};
	}

	private hitAction(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number
	): ActionAnalysis {
		const ev = this.player.hitEv(total, soft, upcardIndex, totCards, key);
		const push = this.player.hitPush(total, soft, upcardIndex, totCards, key);
		return {
			action: 'H',
			evPercent: ev * 100,
			outcome: outcomePercent(outcomeFromEv(ev, push)),
		};
	}

	private doubleAction(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number
	): ActionAnalysis {
		const ev = this.player.doubleEv(total, soft, upcardIndex, totCards, key);
		const push = this.player.doublePush(total, soft, upcardIndex, totCards, key);
		return {
			action: 'D',
			evPercent: ev * 100,
			// Two units are riding on the hand, so its EV is twice its margin.
			outcome: outcomePercent(outcomeFromEv(ev, push, 2)),
		};
	}

	/** The surrender entry, or null at a table (or against an upcard) that doesn't offer it. */
	private surrenderAction(upcard: Rank, totCards: number): ActionAnalysis | null {
		const ev = this.player.surrenderEv(upcard, totCards);
		if (ev === null) return null;
		return { action: 'R', evPercent: ev * 100, outcome: null };
	}

	/** Optimal action (incl. doubling and surrender), EV, and bust odds for each total vs. upcard. */
	analyzeGrid(
		comp0: Composition,
		totals: readonly number[],
		upcards: readonly Rank[],
		soft = false
	): Map<string, CellAnalysis> {
		this.setRoot(comp0);
		const comp = this.shoe.comp;
		const out = new Map<string, CellAnalysis>();
		const totCards = this.shoe.totCardsAfterUpcard();

		for (const upcard of upcards) {
			const upcardIndex = RANK_INDEX[upcard];
			comp[upcardIndex] -= CARD_UNITS;
			const key = KEY_MULT[upcardIndex];
			const dealerBustPercent = this.dealer.bustProb(upcardIndex, totCards, key) * 100;

			for (const total of totals) {
				// A made 21 (e.g. soft A,T) is always stood on -- hitting it is not a
				// real decision, so there is no optimal-play comparison to make.
				if (total >= 21) {
					const stand = this.standAction(total, upcardIndex, totCards, key);
					out.set(gridKey(total, upcard), {
						evPercent: stand.evPercent,
						optimalAction: 'S',
						playerBustOnHitPercent: 0,
						dealerBustPercent,
						actions: [stand],
					});
					continue;
				}

				const actions: ActionAnalysis[] = [
					this.standAction(total, upcardIndex, totCards, key),
					this.doubleAction(total, soft, upcardIndex, totCards, key),
					this.hitAction(total, soft, upcardIndex, totCards, key),
				];
				const surrender = this.surrenderAction(upcard, totCards);
				if (surrender !== null) actions.push(surrender);
				const best = bestAction(actions);

				out.set(gridKey(total, upcard), {
					evPercent: best.evPercent,
					optimalAction: best.action,
					playerBustOnHitPercent: this.player.bustOnHitProb(total, soft, totCards) * 100,
					dealerBustPercent,
					actions,
				});
			}

			comp[upcardIndex] += CARD_UNITS;
		}
		return out;
	}

	/** Optimal action (incl. splitting) and EV/bust odds for each pair vs. upcard. */
	analyzeSplitGrid(
		comp0: Composition,
		pairRanks: readonly Rank[],
		upcards: readonly Rank[]
	): Map<string, CellAnalysis> {
		this.setRoot(comp0);
		const comp = this.shoe.comp;
		const out = new Map<string, CellAnalysis>();
		const totCards = this.shoe.totCardsAfterUpcard();

		for (const upcard of upcards) {
			const upcardIndex = RANK_INDEX[upcard];
			comp[upcardIndex] -= CARD_UNITS;
			const key = KEY_MULT[upcardIndex];
			const dealerBustPercent = this.dealer.bustProb(upcardIndex, totCards, key) * 100;

			for (const rank of pairRanks) {
				const [total, soft] = pairTotal(rank);
				const actions: ActionAnalysis[] = [
					this.standAction(total, upcardIndex, totCards, key),
					this.doubleAction(total, soft, upcardIndex, totCards, key),
					this.hitAction(total, soft, upcardIndex, totCards, key),
				];
				// A split limit of one hand is a table that doesn't split at all.
				if (this.splitLimit >= 2) {
					const split = this.split.analyse(RANK_INDEX[rank], upcardIndex, totCards, key);
					actions.push({
						action: 'P',
						evPercent: split.ev * 100,
						outcome: outcomePercent(split.outcome),
					});
				}
				const surrender = this.surrenderAction(upcard, totCards);
				if (surrender !== null) actions.push(surrender);
				const best = bestAction(actions);

				out.set(splitGridKey(rank, upcard), {
					evPercent: best.evPercent,
					optimalAction: best.action,
					playerBustOnHitPercent: this.player.bustOnHitProb(total, soft, totCards) * 100,
					dealerBustPercent,
					actions,
				});
			}

			comp[upcardIndex] += CARD_UNITS;
		}
		return out;
	}
}

/**
 * Analyses one shoe composition across all three tables with a single engine, so
 * the memos the first grid populates are reused by the other two. The result
 * depends only on `ruleSet` and `comp`, never on the count that produced `comp` --
 * see docs/ev-model.md §Performance notes.
 */
export function computeEvGrids(ruleSet: RuleSet, comp: Composition): EvGrids {
	const engine = new ShoeEv(ruleSet);
	return {
		hard: engine.analyzeGrid(comp, HARD_TOTALS, RANKS, false),
		soft: engine.analyzeGrid(comp, SOFT_TOTALS, RANKS, true),
		split: engine.analyzeSplitGrid(comp, PAIR_RANKS, RANKS),
	};
}
