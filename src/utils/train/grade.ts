/**
 * Grading a Train drill: a thin layer over the Play coach for the decision drills,
 * and the running-count checkpoint for the counting drill. Nothing here prices a
 * hand -- the answer to a decision question is the coach's own `countAction`, read
 * off the same grids at the question's count, so a drill can never disagree with
 * the Play view about what was right. See docs/train-model.md §Grading.
 */

import { bestAction, type ActionAnalysis } from '../ev/outcome';
import type { PlayerAction } from '../ev/rules';
import type { PlayGrids } from '../evWorkerProtocol';
import { cellFor, gradeDecision } from '../play/coach';
import { legalActions, type GameState } from '../play/game';

/** A decision question as the grids price it. */
export interface PricedDecision {
	/** The best legal action at the question's count: the answer. */
	countAction: PlayerAction;
	/** The best legal action off the unadjusted grids. */
	basicAction: PlayerAction;
	/** Every legal action, count-adjusted, best first. */
	prices: ActionAnalysis[];
	/**
	 * Percentage points between the best legal action and the runner-up, or
	 * `Infinity` where only one action is legal. What rules a near-tie out of a
	 * drill -- see `TIE_EPSILON_POINTS` in drills.ts.
	 */
	gapPoints: number;
}

/**
 * Prices the hand `state` is acting on against `grids`, over the actions the
 * table allows it right now -- the same filter and the same maxima the coach
 * takes, plus the margin between the top two. Null where the grids do not
 * reach the hand.
 */
export function priceDecision(state: GameState, grids: PlayGrids): PricedDecision | null {
	const legal = legalActions(state);
	if (legal.length === 0) return null;
	const cell = cellFor(state, legal, grids);
	if (cell === undefined) return null;
	const actions = cell.actions.filter((priced) => legal.includes(priced.action));
	const baseActions = cell.baseActions.filter((priced) => legal.includes(priced.action));
	if (actions.length === 0 || baseActions.length === 0) return null;
	// Stable, so of two equal EVs the engine's own preference stays first --
	// which is the one `bestAction` names.
	const prices = [...actions].sort((a, b) => b.evPercent - a.evPercent);
	return {
		countAction: bestAction(actions).action,
		basicAction: bestAction(baseActions).action,
		prices,
		gapPoints: prices.length > 1 ? prices[0].evPercent - prices[1].evPercent : Infinity,
	};
}

/** One answered decision question. */
export interface DecisionAnswer {
	/** The play taken, or null where the clock ran out first. */
	chosen: PlayerAction | null;
	/** The play the drill wanted. */
	answer: PlayerAction;
	correct: boolean;
	/**
	 * What the choice cost, in percentage points of the wager, off the
	 * count-adjusted prices -- zero or negative, as `Grading.evLostPercent` is.
	 * Null for a timeout, which chose nothing to price.
	 */
	evLostPercent: number | null;
}

/**
 * Grades one decision. The coach does the work: right is `chosen === countAction`,
 * the same test `optimalDecisions` counts in the Play record, and at a count of
 * zero that is simply basic strategy. Null where the grids do not reach the hand.
 */
export function gradeAnswer(
	state: GameState,
	chosen: PlayerAction | null,
	grids: PlayGrids,
	trueCount: number
): DecisionAnswer | null {
	const priced = priceDecision(state, grids);
	if (priced === null) return null;
	if (chosen === null) {
		return { chosen, answer: priced.countAction, correct: false, evLostPercent: null };
	}
	const grading = gradeDecision(state, chosen, grids, trueCount);
	if (grading === null) return null;
	return {
		chosen,
		answer: grading.countAction,
		correct: chosen === grading.countAction,
		evLostPercent: grading.evLostPercent,
	};
}

/**
 * Where the player's count is being measured from: the count they last gave
 * against the running count it was given at. A checkpoint is graded on the
 * change since then, so one slip costs one checkpoint rather than every one
 * after it -- see docs/train-model.md §Counting checkpoints.
 */
export interface CountBasis {
	answer: number;
	runningCount: number;
}

/** A fresh shoe: nothing seen, nothing said. */
export const ZERO_BASIS: CountBasis = { answer: 0, runningCount: 0 };

/** One graded checkpoint. */
export interface CheckpointAnswer {
	/** What the player said, or null where the clock ran out first. */
	answer: number | null;
	/** The running count of every card seen since the shuffle. */
	runningCount: number;
	/**
	 * The answer that would have been right: the basis answer moved by the change
	 * in the running count since it. Equal to `runningCount` whenever the basis is
	 * the true count, as it is after a verdict or a shuffle.
	 */
	expected: number;
	correct: boolean;
}

export function gradeCheckpoint(
	answer: number | null,
	runningCount: number,
	basis: CountBasis,
	tolerance: number
): CheckpointAnswer {
	const expected = basis.answer + (runningCount - basis.runningCount);
	return {
		answer,
		runningCount,
		expected,
		correct: answer !== null && Math.abs(answer - expected) <= tolerance,
	};
}

/**
 * The basis the next checkpoint is measured from. A verdict names the true count,
 * and a player who has just been told it counts on from there, so a drill with
 * feedback resets to it; so does a timeout, which leaves nothing to measure from.
 * Only a drill without feedback carries the player's own answer forward. A
 * shuffle before the next checkpoint overrides all of it -- see `ZERO_BASIS`.
 */
export function nextBasis(graded: CheckpointAnswer, feedback: boolean): CountBasis {
	if (feedback || graded.answer === null) {
		return { answer: graded.runningCount, runningCount: graded.runningCount };
	}
	return { answer: graded.answer, runningCount: graded.runningCount };
}
