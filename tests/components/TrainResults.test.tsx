import { describe, it, expect } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import { gradeCheckpoint, nextBasis, ZERO_BASIS } from '#utils/train/grade';
import { scoreEntry, type CheckpointRecord, type DrillRun } from '#utils/train/run';
import { boardKey, recordScore } from '#utils/train/scores';

import TrainResults from '#c/TrainResults';

import { RULE_SET, TAGS } from '../utils/train/trainGrids';

/** A Test's checkpoints, graded the way the drill grades them, one after another. */
function testCheckpoints(
	said: [answer: number, runningCount: number][]
): CheckpointRecord[] {
	let basis = ZERO_BASIS;
	return said.map(([answer, runningCount], at) => {
		const graded = gradeCheckpoint(answer, runningCount, basis, 0);
		basis = nextBasis(graded, false);
		return { checkpoint: at + 1, graded, timeMs: 1000 };
	});
}

function renderResults(run: DrillRun): void {
	const entry = scoreEntry(run, 'Hi-Lo', new Date('2026-09-11T12:00:00Z'));
	const recorded = recordScore({}, boardKey(run.drill, run.mode, RULE_SET, TAGS), entry);
	render(() => (
		<TrainResults
			run={run}
			entry={entry}
			recorded={recorded}
			system="hi-lo"
			onRetry={() => {}}
			onBack={() => {}}
		/>
	));
}

describe('TrainResults', () => {
	describe('a counting Test’s review', () => {
		it('calls the answer counted on from the last one right, beside the running count', () => {
			// +3 said at a running count of +4, then +5 at +7: the second was due +6.
			renderResults({
				drill: 'counting',
				mode: 'test',
				seed: 1,
				records: testCheckpoints([
					[3, 4],
					[5, 7],
				]),
			});
			const [first, second] = document.querySelectorAll('.train-results__miss');
			expect(first.textContent).toMatch(/Right · \+4/);
			expect(first.textContent).not.toMatch(/RC was/);
			expect(second.textContent).toMatch(/Right · \+6/);
			expect(second.textContent).toMatch(/the RC was \+7/);
			expect(second.textContent).toMatch(/off by 1/);
			expect(screen.queryByText(/Actual RC/)).toBeNull();
		});
	});
});
