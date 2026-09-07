/**
 * How the simulated player decides. Like `play/coach.ts`, this computes no EVs of
 * its own: a priced cell arrives with every action valued twice, and the policy
 * picks one of them. What the three modes differ in is only *which* of the two
 * price lists they read, and whether an index table is laid over the answer.
 *
 * See docs/sim-model.md §Deviation modes.
 */

import type { Composition } from '../ev/composition';
import { insuranceEvPercent } from '../ev/insurance';
import { bestAction, type ActionAnalysis } from '../ev/outcome';
import type { PlayGrids } from '../ev/playGrids';
import type { PlayerAction } from '../ev/rules';
import { cellFor } from '../play/coach';
import type { GameState } from '../play/game';
import type { DeviationMode } from './config';
import { indexAction, INSURANCE_HI_LO_INDEX } from './indices';

/**
 * The engine prices every action a *two-card* hand may take, which is more than
 * a live hand is always offered -- the same intersection `coach.ts` takes, and
 * for the same reason.
 */
function legalOnly(
	actions: readonly ActionAnalysis[],
	legal: readonly PlayerAction[]
): ActionAnalysis[] {
	return actions.filter((action) => legal.includes(action.action));
}

/**
 * What the player does with the hand in front of them.
 *
 * Falls back to the first legal action for a hand the grids cannot price, which
 * no live hand should be -- the Play totals are widened precisely so that none
 * is -- but the loop must still have something to play rather than a throw.
 */
export function decideAction(
	state: GameState,
	legal: readonly PlayerAction[],
	grids: PlayGrids,
	mode: DeviationMode,
	hiLoTrueCount: number
): PlayerAction {
	const cell = cellFor(state, legal, grids);
	if (cell === undefined) return legal.includes('S') ? 'S' : legal[0];

	if (mode === 'full') {
		// The count-adjusted prices outright: an index at every cell, which is the
		// ceiling the Play view's coach grades a decision against.
		const actions = legalOnly(cell.actions, legal);
		if (actions.length === 0) return legal[0];
		return bestAction(actions).action;
	}

	const baseActions = legalOnly(cell.baseActions, legal);
	if (baseActions.length === 0) return legal[0];
	const basic = bestAction(baseActions).action;
	if (mode === 'basic') return basic;
	// The eighteen sit *over* basic strategy rather than replacing it: where no
	// row fires, the unadjusted grids are what is played.
	return indexAction(state, legal, hiLoTrueCount) ?? basic;
}

/**
 * Whether the player takes insurance. `comp` is the count-adjusted composition
 * the round is being played at, which is what `full` prices the bet against --
 * the same reading `ev/insurance.ts` gives the Tables view.
 */
export function decideInsurance(
	mode: DeviationMode,
	comp: Composition,
	hiLoTrueCount: number
): boolean {
	switch (mode) {
		case 'basic':
			// A basic-strategy player never insures: it is a bet on the count, and a
			// player who is not using the count has nothing to make it on.
			return false;
		case 'i18':
			return hiLoTrueCount >= INSURANCE_HI_LO_INDEX;
		case 'full':
			return insuranceEvPercent(comp) > 0;
	}
}
