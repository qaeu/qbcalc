import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@solidjs/testing-library';

import App from '#App';
import { goToPlay, MOUNT_TIMEOUT_MS, resetBrowserState } from './appHarness';

describe('App', () => {
	beforeEach(resetBrowserState);

	describe('the Play view', () => {
		it(
			'offers a third tab that deals a shoe under the current rules',
			async () => {
				render(() => <App />);

				const header = document.querySelector<HTMLElement>('.app-header');
				if (!header) throw new Error('App header not found');
				expect(within(header).getAllByRole('tab')).toHaveLength(3);

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
			'hides the full-calculation button, which Play never asks for',
			async () => {
				window.location.hash = '#play';
				render(() => <App />);

				await waitFor(() => expect(document.querySelector('.play-table')).not.toBeNull());
				expect(screen.queryByRole('button', { name: 'Run full calculation' })).toBeNull();
			},
			MOUNT_TIMEOUT_MS
		);
	});
});
