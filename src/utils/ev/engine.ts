/**
 * The engine that walks one shoe composition: it prices every action a hand may
 * take, picks the best, and fills the three analysis grids from that.
 */

import {
	CARD_UNITS,
	handTotal,
	KEY_MULT,
	pairTotal,
	RANK_INDEX,
	RANKS,
	type Rank,
} from './cards';
import { type Composition } from './composition';
import { DealerModel } from './dealer';
import { dealIndex, dealWeights, type DealWeights } from './deal';
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
	/**
	 * Chance the opening deal produces this cell -- the player's total against
	 * this upcard -- as a percentage of rounds played. See `handOccurrence`.
	 */
	occurrencePercent: number;
	actions: readonly ActionAnalysis[];
}

/**
 * How often the opening deal lands on each grid cell, in percent of rounds, keyed
 * as the grids themselves are.
 *
 * A hand is counted under the total it actually holds, so a pair appears both in
 * its own splits-table cell and under its total in the hard/soft table: T,T is
 * both the T,T cell and part of hard 20, which is what each of those cells is
 * asking about. Totals no grid draws (hard 4-7 and 18-21, soft 12 and 21) are
 * still summed here and simply never looked up.
 */
export interface HandOccurrence {
	hard: Map<string, number>;
	soft: Map<string, number>;
	split: Map<string, number>;
}

/**
 * The average round's EV, short of the one thing a shoe composition does not fix:
 * what the table pays a natural. Splitting it out this way is what keeps
 * `blackjackPayout` from reaching the grids and their `ruleSetKey` cache -- the
 * payout is applied to `naturalPayoutWeight` once, at the top. See
 * docs/ev-model.md §The average hand.
 */
export interface AverageEvParts {
	/**
	 * Probability-weighted EV, in percent of one unit wagered, of every starting
	 * hand that is not a natural.
	 */
	evPercentExNatural: number;
	/** Chance the player's first two cards are a natural. */
	naturalProbability: number;
	/**
	 * The weight the natural's payout multiplies: every natural except those a
	 * dealer natural pushes against.
	 */
	naturalPayoutWeight: number;
}

/**
 * The three analysis grids one shoe composition yields, keyed by `gridKey` /
 * `splitGridKey`, plus the average over every hand it can deal. A comparison
 * table is two of these read side by side.
 */
export interface EvGrids {
	hard: Map<string, CellAnalysis>;
	soft: Map<string, CellAnalysis>;
	split: Map<string, CellAnalysis>;
	average: AverageEvParts;
}

export function gridKey(total: number, upcard: Rank): string {
	return `${total}-${upcard}`;
}

export function splitGridKey(rank: Rank, upcard: Rank): string {
	return `${rank}-${upcard}`;
}

function addOccurrence(grid: Map<string, number>, key: string, percent: number): void {
	grid.set(key, (grid.get(key) ?? 0) + percent);
}

/** Buckets the opening deal's weights into the grids' own keys -- see `HandOccurrence`. */
function handOccurrence(weights: DealWeights): HandOccurrence {
	const occurrence: HandOccurrence = {
		hard: new Map(),
		soft: new Map(),
		split: new Map(),
	};
	const rankCount = RANKS.length;

	for (let upcardIndex = 0; upcardIndex < rankCount; upcardIndex += 1) {
		const upcard = RANKS[upcardIndex];
		for (let low = 0; low < rankCount; low += 1) {
			for (let high = low; high < rankCount; high += 1) {
				const weight = weights[dealIndex(low, high, upcardIndex)];
				if (weight === 0) continue;
				const [total, soft] = handTotal(RANKS[low], RANKS[high]);
				const percent = weight * 100;
				addOccurrence(
					soft ? occurrence.soft : occurrence.hard,
					gridKey(total, upcard),
					percent
				);
				if (low === high) {
					addOccurrence(occurrence.split, splitGridKey(RANKS[low], upcard), percent);
				}
			}
		}
	}

	return occurrence;
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
	private readonly peek: boolean;
	/** The opening deal against the current root, and that deal bucketed per grid. */
	private weights: DealWeights = new Float64Array(0);
	private occurrence: HandOccurrence = {
		hard: new Map(),
		soft: new Map(),
		split: new Map(),
	};

	constructor(ruleSet: RuleSet) {
		this.dealer = new DealerModel(this.shoe, ruleSet);
		this.player = new PlayerModel(this.shoe, this.dealer, ruleSet);
		this.split = new SplitModel(this.shoe, this.dealer, this.player, ruleSet);
		this.splitLimit = ruleSet.splitLimit;
		this.peek = ruleSet.dealerPeek;
	}

	private setRoot(comp0: Composition): void {
		const stale = this.shoe.setRoot(comp0);
		// A thousand-odd multiplications against grids that walk millions of nodes,
		// so it is redone on every entry point rather than tracked as another root
		// key of its own.
		this.weights = dealWeights(comp0);
		this.occurrence = handOccurrence(this.weights);
		if (!stale) return;
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

	/**
	 * Every action a two-card hand may take, priced individually, in the engine's
	 * own preference order. `pairIndex` is the rank the hand is a pair of, or null
	 * for a hand that cannot be split.
	 */
	private handActions(
		total: number,
		soft: boolean,
		upcard: Rank,
		upcardIndex: number,
		totCards: number,
		key: number,
		pairIndex: number | null
	): ActionAnalysis[] {
		const actions: ActionAnalysis[] = [
			this.standAction(total, upcardIndex, totCards, key),
			this.doubleAction(total, soft, upcardIndex, totCards, key),
			this.hitAction(total, soft, upcardIndex, totCards, key),
		];
		// A split limit of one hand is a table that doesn't split at all.
		if (pairIndex !== null && this.splitLimit >= 2) {
			const split = this.split.analyse(pairIndex, upcardIndex, totCards, key);
			actions.push({
				action: 'P',
				evPercent: split.ev * 100,
				outcome: outcomePercent(split.outcome),
			});
		}
		const surrender = this.surrenderAction(upcard, totCards);
		if (surrender !== null) actions.push(surrender);
		return actions;
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
		const occurrence = soft ? this.occurrence.soft : this.occurrence.hard;

		for (const upcard of upcards) {
			const upcardIndex = RANK_INDEX[upcard];
			comp[upcardIndex] -= CARD_UNITS;
			const key = KEY_MULT[upcardIndex];
			const dealerBustPercent = this.dealer.bustProb(upcardIndex, totCards, key) * 100;

			for (const total of totals) {
				const occurrencePercent = occurrence.get(gridKey(total, upcard)) ?? 0;
				// A made 21 (e.g. soft A,T) is always stood on -- hitting it is not a
				// real decision, so there is no optimal-play comparison to make.
				if (total >= 21) {
					const stand = this.standAction(total, upcardIndex, totCards, key);
					out.set(gridKey(total, upcard), {
						evPercent: stand.evPercent,
						optimalAction: 'S',
						playerBustOnHitPercent: 0,
						dealerBustPercent,
						occurrencePercent,
						actions: [stand],
					});
					continue;
				}

				const actions = this.handActions(
					total,
					soft,
					upcard,
					upcardIndex,
					totCards,
					key,
					null
				);
				const best = bestAction(actions);

				out.set(gridKey(total, upcard), {
					evPercent: best.evPercent,
					optimalAction: best.action,
					playerBustOnHitPercent: this.player.bustOnHitProb(total, soft, totCards) * 100,
					dealerBustPercent,
					occurrencePercent,
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
				const cellKey = splitGridKey(rank, upcard);
				const [total, soft] = pairTotal(rank);
				const actions = this.handActions(
					total,
					soft,
					upcard,
					upcardIndex,
					totCards,
					key,
					RANK_INDEX[rank]
				);
				const best = bestAction(actions);

				out.set(cellKey, {
					evPercent: best.evPercent,
					optimalAction: best.action,
					playerBustOnHitPercent: this.player.bustOnHitProb(total, soft, totCards) * 100,
					dealerBustPercent,
					occurrencePercent: this.occurrence.split.get(cellKey) ?? 0,
					actions,
				});
			}

			comp[upcardIndex] += CARD_UNITS;
		}
		return out;
	}

	/**
	 * What one round is worth on average, over every hand the shoe can deal against
	 * every upcard it can show -- naturals included, and each hand played optimally.
	 *
	 * The grids leave two things out that a round's value has to put back. At a
	 * peeking table every cell is priced in a world where the dealer has already
	 * missed their natural, so this mixes the lost wager back in at that upcard's
	 * natural odds; without the peek the cells already carry it. And a player
	 * natural is no play at all, so it is set aside as a weight for the caller to
	 * price -- see `AverageEvParts` and docs/ev-model.md §The average hand.
	 *
	 * Cheap despite pricing a few hundred hands: it runs on an engine whose grids
	 * have already been walked, so nearly every dealer distribution and player
	 * sub-EV it asks for is a memo hit.
	 */
	analyzeAverage(comp0: Composition): AverageEvParts {
		this.setRoot(comp0);
		const comp = this.shoe.comp;
		const totCards = this.shoe.totCardsAfterUpcard();
		const weights = this.weights;
		const rankCount = RANKS.length;

		let evPercentExNatural = 0;
		let naturalProbability = 0;
		let naturalPayoutWeight = 0;

		for (let upcardIndex = 0; upcardIndex < rankCount; upcardIndex += 1) {
			const upcard = RANKS[upcardIndex];
			comp[upcardIndex] -= CARD_UNITS;
			const key = KEY_MULT[upcardIndex];
			const pDealerNatural = this.dealer.blackjackProb(upcard, totCards);
			// Only a peeking table's cells need the natural mixed back in; a no-peek
			// table's cells are unconditional and already carry it.
			const pRebase = this.peek ? pDealerNatural : 0;

			for (let low = 0; low < rankCount; low += 1) {
				for (let high = low; high < rankCount; high += 1) {
					const weight = weights[dealIndex(low, high, upcardIndex)];
					if (weight === 0) continue;

					if (low === RANK_INDEX.T && high === RANK_INDEX.A) {
						naturalProbability += weight;
						naturalPayoutWeight += weight * (1 - pDealerNatural);
						continue;
					}

					const [total, soft] = handTotal(RANKS[low], RANKS[high]);
					const best = bestAction(
						this.handActions(
							total,
							soft,
							upcard,
							upcardIndex,
							totCards,
							key,
							low === high ? low : null
						)
					);
					evPercentExNatural +=
						weight * (pRebase * -100 + (1 - pRebase) * best.evPercent);
				}
			}

			comp[upcardIndex] += CARD_UNITS;
		}

		return { evPercentExNatural, naturalProbability, naturalPayoutWeight };
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
		// Last, so the average is priced against warm memos.
		average: engine.analyzeAverage(comp),
	};
}
