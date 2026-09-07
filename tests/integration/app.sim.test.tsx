import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';

import App from '#App';
import { DEFAULT_SIM_CONFIG, type SimConfig } from '#utils/sim/config';

import {
	fullCalculationButton,
	FULL_RUN_TIMEOUT_MS,
	goToSim,
	MOUNT_TIMEOUT_MS,
	resetBrowserState,
	SIM_RUN_TIMEOUT_MS,
	spyOnWorkerRequests,
} from './appHarness';

/**
 * The smallest run the form offers. Written straight to storage rather than
 * driven through the select, since what these cases are about is the run, and a
 * hundred thousand hands through jsdom is not a test.
 */
function storeTinyConfig(overrides: Partial<SimConfig> = {}): void {
	const config: SimConfig = {
		...DEFAULT_SIM_CONFIG,
		rounds: 1_000,
		reseedEachRun: false,
		seed: 4,
		...overrides,
	};
	localStorage.setItem('qbcalc:sim-config', JSON.stringify({ version: 2, ...config }));
}

const runButton = () => screen.getByRole('button', { name: 'Run simulation' });

/** The card whose label this is, as the text beside it. */
function figure(label: string): string {
	const card = screen.getByText(label).parentElement;
	if (card === null) throw new Error(`no card for ${label}`);
	return card.textContent?.replace(label, '') ?? '';
}

describe('App', () => {
	beforeEach(resetBrowserState);

	describe('the Sim view', () => {
		it(
			'offers a fourth tab carrying the run form',
			async () => {
				render(() => <App />);

				const header = document.querySelector<HTMLElement>('.app-header');
				if (!header) throw new Error('App header not found');
				expect(within(header).getAllByRole('tab')).toHaveLength(4);

				goToSim();
				await waitFor(() => expect(document.querySelector('.sim-view')).not.toBeNull());
				expect(window.location.hash).toBe('#sim');
				expect(runButton()).toBeDefined();
				// Nothing has been dealt, so there is no result to read.
				expect(screen.getByText(/No run yet/)).toBeDefined();
			},
			MOUNT_TIMEOUT_MS
		);

		it(
			'prints the game the run will be dealt under',
			async () => {
				window.location.hash = '#sim';
				render(() => <App />);

				await waitFor(() => expect(document.querySelector('.sim-setup')).not.toBeNull());
				const setup = document.querySelector('.sim-setup') as HTMLElement;
				// The sidebar's own defaults, restated where a result can be read
				// against them.
				expect(setup.textContent).toContain('6 decks');
				expect(setup.textContent).toContain('75% pen');
				expect(setup.textContent).toContain('Hi-Lo');
			},
			MOUNT_TIMEOUT_MS
		);

		it(
			'offers the full calculation, which reprices what it is predicted against',
			async () => {
				window.location.hash = '#sim';
				const postMessage = spyOnWorkerRequests();
				render(() => <App />);

				await waitFor(() => expect(document.querySelector('.sim-view')).not.toBeNull());

				const button = fullCalculationButton();
				await waitFor(() => expect(button).toHaveProperty('disabled', false));
				postMessage.mockClear();

				// The sim deals at 'fast' in its own worker whatever this does; what
				// the button moves is the summary basis the prediction column beside
				// the result is derived from.
				fireEvent.click(button);
				expect(postMessage.mock.calls[0][0]).toMatchObject({
					scope: 'summary',
					precision: 'full',
				});
				await waitFor(() => expect(button).toHaveProperty('disabled', true));

				postMessage.mockRestore();
			},
			FULL_RUN_TIMEOUT_MS
		);

		it(
			'deals a run and fills the stat band and the count table from it',
			async () => {
				storeTinyConfig();
				window.location.hash = '#sim';
				render(() => <App />);

				await waitFor(() => expect(document.querySelector('.sim-view')).not.toBeNull());
				fireEvent.click(runButton());

				await waitFor(() => expect(document.querySelector('.stat-band')).not.toBeNull(), {
					timeout: SIM_RUN_TIMEOUT_MS - 5_000,
				});

				// A thousand hands of a six-deck game: twenty-odd shoes, and rather
				// more hands settled than rounds dealt once splits are counted.
				expect(figure('Hands played')).toMatch(/1,0\d\d/);
				expect(figure('AV')).toMatch(/£/);
				expect(figure('EV')).toMatch(/£/);

				// The walk and the buckets both come with the result.
				expect(document.querySelector('.sim-trajectory__plot')).not.toBeNull();
				const table = document.querySelector('.sim-count-table__table') as HTMLElement;
				const rounds = within(table)
					.getAllByRole('row')
					// The header row carries no figures.
					.slice(1)
					.map((row) =>
						Number(
							(row as HTMLTableRowElement).cells[1].textContent?.replace(/[,k]/g, '') ?? 0
						)
					);
				// Thirteen buckets, and every round dealt is filed in one of them.
				expect(rounds).toHaveLength(13);
				expect(rounds.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
			},
			SIM_RUN_TIMEOUT_MS
		);

		it(
			'replays the same figures from the same seed',
			async () => {
				storeTinyConfig();
				window.location.hash = '#sim';
				render(() => <App />);

				await waitFor(() => expect(document.querySelector('.sim-view')).not.toBeNull());
				fireEvent.click(runButton());
				await waitFor(() => expect(document.querySelector('.stat-band')).not.toBeNull(), {
					timeout: SIM_RUN_TIMEOUT_MS - 5_000,
				});
				const first = figure('AV');

				fireEvent.click(runButton());
				await waitFor(() => expect(runButton()).toBeDefined(), {
					timeout: SIM_RUN_TIMEOUT_MS - 5_000,
				});
				expect(figure('AV')).toBe(first);
			},
			SIM_RUN_TIMEOUT_MS
		);

		it(
			'stops a run when it is cancelled, leaving no result behind',
			async () => {
				// Big enough that it is certainly still dealing when the cancel
				// arrives a turn or two later.
				storeTinyConfig({ rounds: 1_000_000 });
				window.location.hash = '#sim';
				render(() => <App />);

				await waitFor(() => expect(document.querySelector('.sim-view')).not.toBeNull());
				fireEvent.click(runButton());

				const cancel = await screen.findByRole('button', { name: 'Cancel' });
				fireEvent.click(cancel);

				// The run button comes back, and nothing was reported.
				await waitFor(() => expect(runButton()).toBeDefined(), {
					timeout: SIM_RUN_TIMEOUT_MS - 5_000,
				});
				expect(screen.getByText(/No run yet/)).toBeDefined();
				expect(document.querySelector('.stat-band')).toBeNull();
			},
			SIM_RUN_TIMEOUT_MS
		);
	});
});
