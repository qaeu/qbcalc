/**
 * A finished Train drill, and the words its verdicts are written in. What the
 * results screen reads and the board records -- see docs/train-model.md §Scoring.
 */

import type { Rank } from '../ev/cards';
import type { PlayerAction } from '../ev/rules';
import { formatCount } from '../ui/format';
import { partialTotal } from '../play/reveal';
import type { DecisionQuestion, DeviationIndex, DrillId, DrillMode } from './drills';
import type { CheckpointAnswer, DecisionAnswer } from './grade';
import type { ScoreEntry } from './scores';

/** One answered decision question, as the review list lays it out. */
export interface DecisionRecord {
	question: DecisionQuestion;
	graded: DecisionAnswer;
	/** From the last card landing to the answer. */
	timeMs: number;
}

/** One answered checkpoint. */
export interface CheckpointRecord {
	/** From 1. */
	checkpoint: number;
	graded: CheckpointAnswer;
	timeMs: number;
}

/** A drill played to its end. */
export type DrillRun = {
	mode: DrillMode;
	/** What the drill was dealt from. */
	seed: number;
} & (
	| { drill: 'basic' | 'deviation'; records: DecisionRecord[] }
	| { drill: 'counting'; records: CheckpointRecord[] }
);

/** The run as a board keeps it. */
export function scoreEntry(run: DrillRun, rules: string, date: Date): ScoreEntry {
	const all: readonly (DecisionRecord | CheckpointRecord)[] = run.records;
	return {
		correct: all.filter((record) => record.graded.correct).length,
		total: all.length,
		timeMs: Math.round(all.reduce((sum, record) => sum + record.timeMs, 0)),
		date: date.toISOString(),
		seed: run.seed,
		rules,
	};
}

/** Drill names, as the picker and the HUD print them. */
export const DRILL_NAMES: Record<DrillId, string> = {
	basic: 'Basic strategy',
	counting: 'Counting accuracy',
	deviation: 'Deviation recall',
};

export const MODE_NAMES: Record<DrillMode, string> = {
	easy: 'Easy',
	hard: 'Hard',
	test: 'Test',
};

/** Minutes and seconds, as a stopwatch reads: `1:07`. */
export function formatClock(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** 'T' is a ten and 'A' an ace, said aloud. */
function rankName(rank: Rank): string {
	return (
		rank === 'T' ? '10'
		: rank === 'A' ? 'ace'
		: rank
	);
}

/** How a hand reads in a verdict: `pair of 8s v 10`, `soft 18 v ace`. */
export function handPhrase(cards: readonly Rank[], upcard: Rank): string {
	const pair = cards.length === 2 && cards[0] === cards[1];
	const [total, soft] = partialTotal(cards);
	const hand =
		pair ? `pair of ${rankName(cards[0])}s` : `${soft ? 'soft' : 'hard'} ${total}`;
	return `${hand} v ${rankName(upcard)}`;
}

const VERBS: Record<PlayerAction, string> = {
	H: 'hits',
	S: 'stands',
	D: 'doubles',
	P: 'splits',
	R: 'surrenders',
};

/**
 * The index a deviation question turns on, as a verdict names it: `stands from
 * TC +2`, `hits at TC -1 and below`. A control, asked just short of the index,
 * says `only` -- the play it names is the one it did not make.
 */
export function indexPhrase(
	index: DeviationIndex,
	kind: DecisionQuestion['kind']
): string {
	const only = kind === 'control' ? ' only' : '';
	const count = formatCount(index.from);
	return index.from > 0 ?
			`${VERBS[index.action]}${only} from TC ${count}`
		:	`${VERBS[index.action]}${only} at TC ${count} and below`;
}
