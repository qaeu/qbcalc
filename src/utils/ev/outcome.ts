/**
 * How a hand settles: the win/push/lose algebra the engine carries alongside its
 * EVs, and the per-action shape the UI reads.
 */

import type { PlayerAction } from './rules';

/**
 * How a hand settles, as percentages that sum to 100. These are *hand*
 * probabilities, not stake-weighted: a doubled winner counts once here, and shows
 * up as twice the money in the EV beside it.
 */
export interface ActionOutcome {
	winPercent: number;
	pushPercent: number;
	losePercent: number;
}

/** One action a hand may take, priced on its own rather than against the others. */
export interface ActionAnalysis {
	action: PlayerAction;
	/** EV of taking this action and then playing on optimally, in percent of one unit wagered. */
	evPercent: number;
	/**
	 * `null` for surrender, which settles for a flat half-loss without a showdown,
	 * so none of win/push/lose describes it.
	 *
	 * For a split these are the odds for *one* of the resulting hands (the two are
	 * symmetric), while `evPercent` covers both hands' stakes together -- see
	 * docs/ev-model.md §The split budget.
	 */
	outcome: ActionOutcome | null;
}

/** A hand's settlement probabilities, as fractions of 1. */
export interface Outcome {
	win: number;
	push: number;
	lose: number;
}

export const ZERO_OUTCOME: Outcome = { win: 0, push: 0, lose: 0 };

/**
 * Recovers a hand's settlement odds from its EV and its chance of pushing, with
 * `stake` the units riding on the hand (2 for a double, 1 otherwise). See
 * docs/ev-model.md §Settlement odds from EV.
 */
export function outcomeFromEv(ev: number, push: number, stake = 1): Outcome {
	const margin = ev / stake;
	const lose = (1 - push - margin) / 2;
	return { win: margin + lose, push, lose };
}

export function scaleOutcome(outcome: Outcome, factor: number): Outcome {
	return {
		win: outcome.win * factor,
		push: outcome.push * factor,
		lose: outcome.lose * factor,
	};
}

export function addOutcome(a: Outcome, b: Outcome): Outcome {
	return { win: a.win + b.win, push: a.push + b.push, lose: a.lose + b.lose };
}

/** Rounding can push a probability a hair outside [0, 1]; percentages shouldn't show it. */
export function toPercent(probability: number): number {
	return Math.min(100, Math.max(0, probability * 100));
}

export function outcomePercent(outcome: Outcome): ActionOutcome {
	return {
		winPercent: toPercent(outcome.win),
		pushPercent: toPercent(outcome.push),
		losePercent: toPercent(outcome.lose),
	};
}

/**
 * `E[X²]` for one action's settlement, in units² of the base wager -- the second
 * moment a variance figure is built from. A hand riding `s` units returns `±s` or
 * `0`, so `E[X²] = s²·(1 − push)`. See docs/bankroll-model.md §Variance per round.
 */
export function actionSecondMoment(action: ActionAnalysis): number {
	const push = action.outcome === null ? 0 : action.outcome.pushPercent / 100;
	switch (action.action) {
		case 'D':
			return 4 * (1 - push);
		case 'R':
			// A flat half-unit loss every time -- no showdown, so no spread at all.
			return 0.25;
		case 'P': {
			// `outcome` describes one of the two symmetric hands while `evPercent`
			// covers both stakes, so the per-hand margin is half of it. The siblings
			// are summed as independent -- simplification 1 already keeps them from
			// seeing each other's cards -- giving E[(X₁+X₂)²] = 2·E[X²] + 2·E[X]².
			const handEv = action.evPercent / 200;
			return 2 * (1 - push) + 2 * handEv * handEv;
		}
		default:
			return 1 - push;
	}
}

/**
 * Picks the action the engine plays, and with it the cell's EV: the highest EV
 * wins, and the earliest entry wins a tie.
 */
export function bestAction(actions: readonly ActionAnalysis[]): ActionAnalysis {
	let best = actions[0];
	for (const action of actions) {
		if (action.evPercent > best.evPercent) best = action;
	}
	return best;
}
