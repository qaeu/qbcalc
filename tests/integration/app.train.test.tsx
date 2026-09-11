import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';

import App from '#App';
import {
	goToBankroll,
	goToTables,
	goToTrain,
	MOUNT_TIMEOUT_MS,
	resetBrowserState,
	settlingTime,
	spyOnWorkerRequests,
	workerRequests,
} from './appHarness';

/** A drill's panel on the picker, by its heading. */
function drillPanel(name: string): HTMLElement {
	return screen.getByRole('heading', { name }).closest('article') as HTMLElement;
}

describe('App', () => {
	beforeEach(resetBrowserState);
	afterEach(() => localStorage.clear());

	describe('the Train view', () => {
		it(
			'sits between Play and Sim, and opens on the drills',
			async () => {
				render(() => <App />);
				const header = document.querySelector<HTMLElement>('.app-header')!;
				const tabs = within(header)
					.getAllByRole('tab')
					.map((tab) => tab.textContent);
				expect(tabs).toEqual(['Tables', 'Bankroll', 'Play', 'Train', 'Sim']);

				goToTrain();
				await waitFor(() =>
					expect(screen.getAllByRole('button', { name: 'Start' })).toHaveLength(3)
				);
				expect(window.location.hash).toBe('#train');
			},
			MOUNT_TIMEOUT_MS
		);

		it(
			'prices a drill’s counts in one request, then deals it',
			async () => {
				window.location.hash = '#train';
				const postMessage = spyOnWorkerRequests();
				render(() => <App />);

				const panel = drillPanel('Deviation recall');
				fireEvent.click(within(panel).getByRole('radio', { name: 'Hard' }));
				fireEvent.click(within(panel).getByRole('button', { name: 'Start' }));

				await waitFor(
					() => expect(screen.getByText(/Hand/).textContent).toMatch(/1\s*\/\s*20/),
					{ timeout: MOUNT_TIMEOUT_MS }
				);
				const train = workerRequests(postMessage).filter(
					(request) => request.scope === 'train'
				);
				expect(train).toHaveLength(1);
				expect(train[0].trueCounts!.length).toBeGreaterThan(5);
				expect(document.querySelector('.train-drill__puck')).not.toBeNull();

				postMessage.mockRestore();
			},
			MOUNT_TIMEOUT_MS
		);

		it(
			'answers a second drill on the same counts without asking the worker again',
			async () => {
				window.location.hash = '#train';
				const postMessage = spyOnWorkerRequests();
				render(() => <App />);

				fireEvent.click(
					within(drillPanel('Basic strategy')).getByRole('button', { name: 'Start' })
				);
				await waitFor(() => expect(screen.getByText(/Hand/)).toBeDefined(), {
					timeout: MOUNT_TIMEOUT_MS,
				});
				fireEvent.keyDown(document, { key: 'Escape' });
				fireEvent.click(
					within(drillPanel('Counting accuracy')).getByRole('button', { name: 'Start' })
				);
				await waitFor(() => expect(screen.getByText(/Checkpoint/)).toBeDefined());

				const train = workerRequests(postMessage).filter(
					(request) => request.scope === 'train'
				);
				expect(train).toHaveLength(1);

				postMessage.mockRestore();
			},
			MOUNT_TIMEOUT_MS
		);

		it(
			'forgets a drill’s counts once it stops waiting on them',
			async () => {
				window.location.hash = '#train';
				const postMessage = spyOnWorkerRequests();
				render(() => <App />);

				// Started while the summary the app mounts with is still out, so the
				// request is held -- then abandoned before it ever goes.
				fireEvent.click(
					within(drillPanel('Deviation recall')).getByRole('button', { name: 'Start' })
				);
				fireEvent.click(screen.getByRole('button', { name: 'Back to drills' }));
				goToTables();

				await waitFor(
					() => {
						expect(document.querySelector('.ev-table__cell-figure')).not.toBeNull();
						expect(document.querySelector('.ev-table__cell-skeleton')).toBeNull();
					},
					{ timeout: MOUNT_TIMEOUT_MS }
				);
				await settlingTime();
				const scopes = workerRequests(postMessage).map((request) => request.scope);
				expect(scopes).not.toContain('train');

				postMessage.mockRestore();
			},
			MOUNT_TIMEOUT_MS
		);

		it(
			'asks for another tab twice once a drill has an answer in it',
			async () => {
				window.location.hash = '#train';
				render(() => <App />);

				const panel = drillPanel('Basic strategy');
				fireEvent.click(within(panel).getByRole('radio', { name: 'Easy' }));
				fireEvent.click(within(panel).getByRole('button', { name: 'Start' }));
				await waitFor(() => expect(screen.getByText(/Hand/)).toBeDefined(), {
					timeout: MOUNT_TIMEOUT_MS,
				});
				// The bar unlocks once the last card has landed, at the Play view's speed.
				await waitFor(
					() =>
						expect(document.querySelector('.train-drill__shelf.is-shown')).not.toBeNull(),
					{ timeout: 5000 }
				);
				fireEvent.keyDown(document, { key: '1' });
				expect(document.querySelector('.felt__verdict')).not.toBeNull();

				goToBankroll();
				await waitFor(() =>
					expect(screen.getByText(/Click Bankroll again to leave/)).toBeDefined()
				);
				expect(window.location.hash).toBe('#train');

				goToBankroll();
				await waitFor(() => expect(window.location.hash).toBe('#bankroll'));
			},
			MOUNT_TIMEOUT_MS
		);
	});
});
