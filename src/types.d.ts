/**
 * Centralized type definitions for qbcalc
 * This file contains all shared type definitions used across the application
 */

export interface Settings {
	darkMode: boolean;
}

// Utility Types

/**
 * Merges two types A and B, with B's properties taking precedence in case of conflicts
 */
export type Merge<A, B> = Omit<A, keyof B> & B;

// Cards

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

export type Rank =
	| 'A'
	| '2'
	| '3'
	| '4'
	| '5'
	| '6'
	| '7'
	| '8'
	| '9'
	| '10'
	| 'J'
	| 'Q'
	| 'K';

export interface Card {
	rank: Rank;
	suit?: Suit;
}

/** A hand total; `soft` means an ace is still counted as 11. */
export interface HandTotal {
	value: number;
	soft: boolean;
}

// Rules

export type PlayerAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

/** Table rules that materially affect EV. */
export interface RuleSet {
	decks: number;
	dealerHitsSoft17: boolean;
	blackjackPayout: number;
	doubleAfterSplit: boolean;
	surrenderAllowed: boolean;
	maxSplits: number;
}

// EV results

export interface ActionEV {
	action: PlayerAction;
	ev: number;
}

export interface EVResult {
	actions: ActionEV[];
	/** The highest-EV action from `actions`. */
	best: PlayerAction;
}
