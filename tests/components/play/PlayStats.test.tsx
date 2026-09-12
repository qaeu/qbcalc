import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';

import { EMPTY_PLAY_STATS, type PlayStats as PlayStatsRecord } from '#utils/play/stats';

import PlayStats from '#c/play/PlayStats';

/** A session's worth of play, with every card's figure distinguishable. */
const SAMPLE: PlayStatsRecord = {
	av: 420.5,
	ev: 210.25,
	hands: 260,
	rounds: 240,
	decisions: 200,
	optimalDecisions: 184,
	basicErrors: 11,
	deviationErrors: 5,
	evLost: 37,
	variance: 10000,
};

/** The card whose label this is, as the value beside it. */
function figure(label: string): string {
	const card = screen.getByText(label).parentElement;
	if (card === null) throw new Error(`no card for ${label}`);
	return card.textContent?.replace(label, '') ?? '';
}

describe('PlayStats', () => {
	it('renders every figure from the record', () => {
		render(() => <PlayStats stats={SAMPLE} onReset={() => {}} />);

		expect(figure('AV')).toContain('£420.50');
		expect(figure('EV')).toContain('£210.25');
		expect(figure('Hands played')).toContain('260');
		// 184 of 200 decisions.
		expect(figure('Optimal play')).toContain('92.0%');
		expect(figure('Basic-strategy errors')).toContain('11');
		expect(figure('Deviation errors')).toContain('5');
		expect(figure('EV lost')).toContain('£37');
		// (420.5 - 210.25) / sqrt(10000).
		expect(figure('EV deviation')).toContain('2.10');
	});

	it('suppresses the figures nothing supports yet', () => {
		render(() => <PlayStats stats={EMPTY_PLAY_STATS} onReset={() => {}} />);

		// No decisions to have played optimally, and no variance yet to divide by.
		expect(figure('Optimal play')).toContain('—');
		expect(figure('EV deviation')).toContain('—');
	});

	describe('reset', () => {
		it('asks before it clears anything', () => {
			const onReset = vi.fn();
			render(() => <PlayStats stats={SAMPLE} onReset={onReset} />);

			fireEvent.click(screen.getByRole('button', { name: 'Reset stats' }));

			expect(onReset).not.toHaveBeenCalled();
			expect(screen.getByRole('button', { name: 'Confirm reset?' })).toBeDefined();
		});

		it('clears the record on the second press', () => {
			const onReset = vi.fn();
			render(() => <PlayStats stats={SAMPLE} onReset={onReset} />);

			fireEvent.click(screen.getByRole('button', { name: 'Reset stats' }));
			fireEvent.click(screen.getByRole('button', { name: 'Confirm reset?' }));

			expect(onReset).toHaveBeenCalledTimes(1);
			// And the button goes back to being the one that asks.
			expect(screen.getByRole('button', { name: 'Reset stats' })).toBeDefined();
		});

		it('backs out on cancel', () => {
			const onReset = vi.fn();
			render(() => <PlayStats stats={SAMPLE} onReset={onReset} />);

			fireEvent.click(screen.getByRole('button', { name: 'Reset stats' }));
			fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

			expect(onReset).not.toHaveBeenCalled();
			expect(screen.getByRole('button', { name: 'Reset stats' })).toBeDefined();
		});
	});
});
