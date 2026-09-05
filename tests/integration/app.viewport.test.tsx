import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

import App from '#App';
import { MOUNT_TIMEOUT_MS, resetBrowserState, stubViewport } from './appHarness';

describe('App', () => {
	beforeEach(resetBrowserState);

	describe('on a compact viewport', () => {
		it(
			'moves the settings out of the layout and behind the header button',
			async () => {
				stubViewport(390, 844);
				render(() => <App />);

				// Neither in the page nor mounted anywhere else: the drawer holds it,
				// and the drawer does not mount until it is first opened.
				expect(document.querySelector('.app__layout .settings-sidebar')).toBeNull();
				expect(document.querySelector('.settings-sidebar')).toBeNull();

				fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

				await waitFor(() =>
					expect(
						document.querySelector('.settings-drawer .settings-sidebar')
					).not.toBeNull()
				);
				// Still out of the flow of the page itself.
				expect(document.querySelector('.app__layout .settings-sidebar')).toBeNull();
			},
			MOUNT_TIMEOUT_MS
		);

		it(
			'opens the settings on a landscape phone, which is short rather than narrow',
			() => {
				// 844x390 clears the 800px width breakpoint entirely, so this is the
				// max-height half of the query doing the work on its own. The button
				// has no second, CSS-side gate precisely so that it cannot go missing
				// here while the sidebar is pulled out of the layout regardless.
				stubViewport(844, 390);
				render(() => <App />);

				expect(document.querySelector('.app__layout .settings-sidebar')).toBeNull();
				expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined();
			},
			MOUNT_TIMEOUT_MS
		);

		it(
			'keeps the sidebar in the layout on a desktop viewport',
			() => {
				stubViewport(1440, 900);
				render(() => <App />);

				expect(document.querySelector('.app__layout .settings-sidebar')).not.toBeNull();
				expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
			},
			MOUNT_TIMEOUT_MS
		);
	});
});
