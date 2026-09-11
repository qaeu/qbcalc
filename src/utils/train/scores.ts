/**
 * A Train drill's highscores: a top five per board, where a board is one drill at
 * one mode under whatever the drill's answers depend on. See docs/train-model.md
 * §Scoring.
 */

import { RANKS } from '../ev/cards';
import type { TagValues } from '../ev/composition';
import { ruleSetKey, type RuleSet } from '../ev/rules';
import { DRILL_IDS, DRILL_MODES, type DrillId, type DrillMode } from './drills';

/** How many runs a board keeps. */
export const BOARD_SIZE = 5;

/** One finished run, as a board keeps it. */
export interface ScoreEntry {
	correct: number;
	total: number;
	/** The sum of the answer times, in milliseconds -- the tie-break. */
	timeMs: number;
	/** When the run finished, as an ISO string. */
	date: string;
	/** What the drill was dealt from, so a run can be dealt again. */
	seed: number;
	/** The game the run was graded under, for the board to name. */
	rules: string;
}

/** Every board, by `boardKey`, best run first. */
export type ScoreBoards = Readonly<Record<string, readonly ScoreEntry[]>>;

/**
 * Which board a run belongs on: the drill and mode, plus exactly what the
 * drill's answers depend on. Basic strategy is a property of the rules alone,
 * so its board ignores the counting system; counting is a property of the tags
 * alone, so its board ignores the rules; the deviation drill needs both.
 */
export function boardKey(
	drill: DrillId,
	mode: DrillMode,
	ruleSet: RuleSet,
	tags: TagValues
): string {
	const rules = ruleSetKey(ruleSet);
	const tagKey = RANKS.map((rank) => tags[rank]).join(',');
	const basis =
		drill === 'basic' ? rules
		: drill === 'counting' ? tagKey
		: `${rules}/${tagKey}`;
	return `${drill}:${mode}:${basis}`;
}

/**
 * The rules a basic or deviation board is keyed on, the way a table card
 * prints them. Only the fields `ruleSetKey` covers, since those are the only
 * ones that can move an answer: the payout and the penetration never reach the
 * grids.
 */
export function describeRules(ruleSet: RuleSet): string {
	const parts = [
		`${ruleSet.decks} ${ruleSet.decks === 1 ? 'deck' : 'decks'}`,
		ruleSet.dealerHitsSoft17 ? 'H17' : 'S17',
	];
	if (ruleSet.doubleAfterSplit) parts.push('DAS');
	parts.push(ruleSet.splitLimit > 1 ? `Split to ${ruleSet.splitLimit}` : 'No split');
	if (ruleSet.resplitAces) parts.push('RSA');
	if (ruleSet.hitSplitAces) parts.push('Hit split aces');
	parts.push(ruleSet.dealerPeek ? 'Peek' : 'No peek');
	parts.push(SURRENDER_LABELS[ruleSet.surrender]);
	return parts.join(' · ');
}

const SURRENDER_LABELS: Readonly<Record<RuleSet['surrender'], string>> = {
	early: 'Early surrender',
	es10: 'Early surrender vs 10',
	late: 'Late surrender',
	none: 'No surrender',
};

/** More right first, then quicker. Negative where `a` ranks above `b`. */
export function compareEntries(a: ScoreEntry, b: ScoreEntry): number {
	return b.correct / b.total - a.correct / a.total || a.timeMs - b.timeMs;
}

/** What recording a run did. */
export interface RecordedScore {
	boards: ScoreBoards;
	/** The run's place on its board, from 1, or null where it did not make it. */
	rank: number | null;
	/** The board after the run, best first. */
	board: readonly ScoreEntry[];
	/** Whether the run displaced the board's best -- or filled an empty one. */
	newBest: boolean;
}

/**
 * Enters a run on its board. A run that only equals one already there ranks
 * beneath it: the older run got there first.
 */
export function recordScore(
	boards: ScoreBoards,
	key: string,
	entry: ScoreEntry
): RecordedScore {
	const existing = boards[key] ?? [];
	const place = existing.findIndex((other) => compareEntries(entry, other) < 0);
	const at = place === -1 ? existing.length : place;
	const board = [...existing.slice(0, at), entry, ...existing.slice(at)].slice(
		0,
		BOARD_SIZE
	);
	const rank = at < BOARD_SIZE ? at + 1 : null;
	return { boards: { ...boards, [key]: board }, rank, board, newBest: rank === 1 };
}

/** The best run on a board, if it has one. */
export function bestOn(boards: ScoreBoards, key: string): ScoreEntry | undefined {
	return boards[key]?.[0];
}

function isScoreEntry(value: unknown): value is ScoreEntry {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		Number.isInteger(entry.correct)
		&& Number.isInteger(entry.total)
		&& (entry.total as number) > 0
		&& (entry.correct as number) >= 0
		&& (entry.correct as number) <= (entry.total as number)
		&& Number.isFinite(entry.timeMs)
		&& (entry.timeMs as number) >= 0
		&& typeof entry.date === 'string'
		&& Number.isFinite(entry.seed)
		&& typeof entry.rules === 'string'
	);
}

/**
 * Whether a stored value is a set of boards. A key that is not a drill and mode
 * this build offers, or a board with a malformed run on it, fails the whole
 * record -- the storage layer drops what it cannot trust rather than half of it.
 */
export function isScoreBoards(value: unknown): value is ScoreBoards {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	return Object.entries(value).every(([key, board]) => {
		const [drill, mode] = key.split(':');
		return (
			(DRILL_IDS as readonly string[]).includes(drill)
			&& (DRILL_MODES as readonly string[]).includes(mode)
			&& Array.isArray(board)
			&& board.length <= BOARD_SIZE
			&& board.every(isScoreEntry)
		);
	});
}
