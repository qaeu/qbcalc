/**
 * Grading one played decision against the engine's own prices. Nothing here
 * computes an EV: a Play cell arrives with every action already priced twice --
 * once against the count-adjusted shoe and once against the unadjusted one --
 * and this filters both lists down to what the table actually allows right now,
 * picks the best of each, and says which of them the player took. See
 * docs/play-model.md §Grading a decision.
 */

import { gridKey, splitGridKey } from '../ev/engine';
import { actionSecondMoment, bestAction, type ActionAnalysis } from '../ev/outcome';
import type { PlayerAction } from '../ev/rules';
import type { PlayCell, PlayGrids } from '../evWorkerProtocol';
import { legalActions, type GameState } from './game';

export interface Grading {
	chosen: PlayerAction;
	/** Best legal action off the unadjusted full-shoe grid. */
	basicAction: PlayerAction;
	/** Best legal action off the count-adjusted grid. */
	countAction: PlayerAction;
	/**
	 * What the choice cost, in percentage points of the wager, measured on the
	 * count-adjusted prices: `countEv(chosen) - countEv(countAction)`. **Zero or
	 * negative**, never positive -- nothing beats the best action -- and exactly
	 * zero when the best action was the one taken.
	 */
	evLostPercent: number;
	/** EV of the action actually chosen, percent of the wager. */
	chosenEvPercent: number;
	/**
	 * `E[X²]` of the action actually chosen, in units² of the wager -- see
	 * `actionSecondMoment`. What `stats.ts` builds the running variance from.
	 */
	chosenSecondMoment: number;
	/** chosen !== basicAction */
	basicError: boolean;
	/** chosen === basicAction but chosen !== countAction */
	deviationError: boolean;
	/** The true count the grids were priced at, for the banner's wording. */
	trueCount: number;
}

/**
 * The engine prices every action a *two-card* hand may take, which is more than
 * a live hand is always offered: no double once a card has been drawn, no
 * surrender past the first decision, no split beyond the round's budget. The
 * grids know none of that, so the comparison is made over the intersection.
 */
function legalOnly(
	actions: readonly ActionAnalysis[],
	legal: readonly PlayerAction[]
): ActionAnalysis[] {
	return actions.filter((action) => legal.includes(action.action));
}

/**
 * The cell a live hand is looked up in. A multi-card hand is priced by its
 * *total*, as the grids are indexed -- so 5,4,3 is graded as the hard 12 it is.
 * A pair the player may still split is looked up in the splits grid instead,
 * since that is the only grid whose cell carries a price for splitting it.
 */
function cellFor(
	state: GameState,
	legal: readonly PlayerAction[],
	grids: PlayGrids
): PlayCell | undefined {
	const hand = state.hands[state.activeHandIndex];
	const upcard = state.dealer.cards[0];
	if (legal.includes('P')) {
		return grids.split.get(splitGridKey(hand.cards[0], upcard));
	}
	const grid = hand.soft ? grids.soft : grids.hard;
	return grid.get(gridKey(hand.total, upcard));
}

/**
 * Grades one decision. Returns null when the hand falls outside the grids
 * (nothing to grade against) -- the caller then counts no decision at all.
 *
 * `trueCount` is the count the grids were priced at; it is reported back rounded
 * to the whole count the grading composition is actually built at (see
 * docs/play-model.md §The grading basis), so a banner quotes the shoe the
 * verdict came from rather than the running fraction beside it.
 */
export function gradeDecision(
	state: GameState,
	action: PlayerAction,
	grids: PlayGrids,
	trueCount: number
): Grading | null {
	if (state.phase !== 'act') return null;
	const legal = legalActions(state);
	if (legal.length === 0) return null;

	const cell = cellFor(state, legal, grids);
	if (cell === undefined) return null;

	const actions = legalOnly(cell.actions, legal);
	const baseActions = legalOnly(cell.baseActions, legal);
	const chosen = actions.find((priced) => priced.action === action);
	if (chosen === undefined || baseActions.length === 0) return null;

	const countAction = bestAction(actions);
	const basicAction = bestAction(baseActions);
	const basicError = action !== basicAction.action;

	return {
		chosen: action,
		basicAction: basicAction.action,
		countAction: countAction.action,
		// Both sides are read off the count-adjusted prices, so what is measured is
		// what the play cost at this shoe rather than the gap between two frames.
		evLostPercent: chosen.evPercent - countAction.evPercent,
		chosenEvPercent: chosen.evPercent,
		chosenSecondMoment: actionSecondMoment(chosen),
		basicError,
		deviationError: !basicError && action !== countAction.action,
		trueCount: Math.round(trueCount),
	};
}
