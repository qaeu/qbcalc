/**
 * How much accuracy the engine is being asked for. Two presets: the cheap one the
 * app runs on by default, and the expensive one behind the "run full calculation"
 * button. See docs/ev-model.md §Precision modes.
 *
 * This is not a rule -- it says nothing about the game being played -- so it must
 * never enter `RuleSet` or `ruleSetKey`.
 */

/** What a precision setting turns into inside the engine. */
export interface Precision {
	/** Cards a recursion tracks removals for before freezing the shoe. */
	drawCap: number;
	/** Whether `analyzeAverage` removes the player's two cards before pricing. */
	removePlayerCards: boolean;
}

/**
 * The default: the shoe freezes after two cards and the player's own two cards
 * stay in it. About twice as fast as an uncapped walk, and about 0.09 points
 * house-favourable on a six-deck game.
 */
export const FAST_PRECISION: Precision = { drawCap: 2, removePlayerCards: false };

/**
 * The deliberate one: deep enough that the freeze costs an order of magnitude less
 * than the removal it is paid for, with the player's cards taken out of the shoe
 * before the hand is priced.
 */
export const FULL_PRECISION: Precision = { drawCap: 4, removePlayerCards: true };

/** What crosses the worker boundary and what the worker's caches key on. */
export type PrecisionId = 'fast' | 'full';

export function precisionFor(id: PrecisionId): Precision {
	return id === 'full' ? FULL_PRECISION : FAST_PRECISION;
}
