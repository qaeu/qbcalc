import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';

import App from '#App';
import {
	fullCalculationButton,
	FULL_RUN_TIMEOUT_MS,
	goToPlay,
	MOUNT_TIMEOUT_MS,
	resetBrowserState,
	spyOnWorkerRequests,
	workerRequests,
} from './appHarness';

describe('App', () => {
	beforeEach(resetBrowserState);

	describe('the Play view', () => {
		it(
			'offers a tab of its own that deals a shoe under the current rules',
			async () => {
				render(() => <App />);

				const header = document.querySelector<HTMLElement>('.app-header');
				if (!header) throw new Error('App header not found');
				expect(within(header).getAllByRole('tab')).toHaveLength(5);

				goToPlay();
				await waitFor(() => expect(document.querySelector('.play-table')).not.toBeNull());
				expect(window.location.hash).toBe('#play');

				// The felt opens on the bet phase, with the rail waiting for a chip.
				expect(screen.getByRole('button', { name: /Deal/ })).toBeDefined();
			},
			MOUNT_TIMEOUT_MS
		);

		it(
			'opens on the Play view when the hash asks for it',
			async () => {
				window.location.hash = '#play';
				render(() => <App />);

				await waitFor(() => expect(document.querySelector('.play-table')).not.toBeNull());
				// The grids are the Tables view's, and it is not the view on screen.
				expect(document.querySelector('.ev-table__mode')).toBeNull();
			},
			MOUNT_TIMEOUT_MS
		);

		it(
			'offers the full calculation, which reprices the summary figures',
			async () => {
				window.location.hash = '#play';
				const postMessage = spyOnWorkerRequests();
				render(() => <App />);

				await waitFor(() => expect(document.querySelector('.play-table')).not.toBeNull());

				const button = fullCalculationButton();
				await waitFor(() => expect(button).toHaveProperty('disabled', false));
				postMessage.mockClear();

				// The Play coach grades off 'play'-scope grids, which stay fast; what
				// the button reprices here is the summary basis the sidebar's own
				// Kelly hint -- and the Sim view's prediction column -- read.
				fireEvent.click(button);
				expect(
					workerRequests(postMessage).find((request) => request.precision === 'full')
				).toMatchObject({ scope: 'summary', precision: 'full' });
				await waitFor(() => expect(button).toHaveProperty('disabled', true));

				postMessage.mockRestore();
			},
			FULL_RUN_TIMEOUT_MS
		);
	});
});
