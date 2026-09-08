import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

import App from '#App';
import { DEFAULT_CONFIG, loadCalculatorConfig } from '#utils/storage';
import {
	goToBankroll,
	MOUNT_TIMEOUT_MS,
	resetBrowserState,
	skeletons,
	summaryText,
} from './appHarness';

describe('App', () => {
	beforeEach(resetBrowserState);

	it(
		'renders the application heading',
		() => {
			render(() => <App />);
			expect(
				screen.getByRole('heading', { name: 'qbcalc · blackjack ev' })
			).toBeDefined();
		},
		MOUNT_TIMEOUT_MS
	);

	it(
		'recalculates once the settings settle, with no button to press',
		async () => {
			render(() => <App />);

			expect(screen.queryByRole('button', { name: 'Calculate' })).toBeNull();

			fireEvent.input(screen.getByLabelText('Decks'), { target: { value: '2' } });

			await waitFor(() =>
				expect(loadCalculatorConfig()).toEqual({ ...DEFAULT_CONFIG, decks: 2 })
			);
		},
		MOUNT_TIMEOUT_MS
	);

	it(
		'recalculates the summary cards on a Rules edit made while Bankroll is on screen',
		async () => {
			render(() => <App />);
			goToBankroll();

			await waitFor(() => expect(summaryText()).toBeDefined());
			await waitFor(() => expect(skeletons()).toBe(0));
			const before = summaryText();

			// The Rules tab lives in the sidebar, alongside Bankroll's own cards --
			// it has nothing to do with the header's Tables/Bankroll switch, so this
			// edit never has to leave the Bankroll view to be made.
			fireEvent.input(screen.getByLabelText('Decks'), { target: { value: '2' } });

			await waitFor(() =>
				expect(loadCalculatorConfig()).toEqual({ ...DEFAULT_CONFIG, decks: 2 })
			);
			await waitFor(() => expect(summaryText()).not.toBe(before));
			expect(skeletons()).toBe(0);
		},
		MOUNT_TIMEOUT_MS
	);
});
