import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

import App from '#App';
import { DEFAULT_CONFIG } from '#utils/storage';
import {
	fullCalculationButton,
	FULL_RUN_TIMEOUT_MS,
	goToBankroll,
	resetBrowserState,
	skeletons,
	spyOnWorkerRequests,
	summaryText,
} from './appHarness';

describe('App', () => {
	beforeEach(resetBrowserState);

	describe('the full calculation button', () => {
		it(
			'dispatches a full request, and goes back to fast on the next edit',
			async () => {
				const postMessage = spyOnWorkerRequests();
				render(() => <App />);

				// The calculation the app mounts with, which is always the fast one.
				expect(postMessage).toHaveBeenCalledTimes(1);
				expect(postMessage.mock.calls[0][0]).toMatchObject({ precision: 'fast' });
				postMessage.mockClear();

				// The button is disabled for the whole of a calculation, mount's
				// included, so the first one has to land before it can be pressed.
				const button = fullCalculationButton();
				await waitFor(() => expect(button).toHaveProperty('disabled', false));

				fireEvent.click(button);
				expect(postMessage).toHaveBeenCalledTimes(1);
				expect(postMessage.mock.calls[0][0]).toMatchObject({ precision: 'full' });

				// Once the full figures are on screen there is nothing left for the
				// button to compute.
				await waitFor(() => expect(button).toHaveProperty('disabled', true));
				postMessage.mockClear();

				// One-shot: nothing else in the app ever asks for 'full', so the very
				// next recalculation drops back.
				fireEvent.input(screen.getByLabelText('Decks'), { target: { value: '2' } });
				await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
				expect(postMessage.mock.calls[0][0]).toMatchObject({ precision: 'fast' });
				await waitFor(() => expect(button).toHaveProperty('disabled', false));

				postMessage.mockRestore();
			},
			FULL_RUN_TIMEOUT_MS
		);

		it(
			'moves the bankroll figures, and puts them back on the next fast result',
			async () => {
				// Every bankroll figure is derived from the average, so a full run has to
				// reach the summary basis the cards read -- which it does not do by
				// changing any setting, since it re-dispatches the ones already entered.
				render(() => <App />);
				goToBankroll();

				await waitFor(() => expect(summaryText()).toBeDefined());
				await waitFor(() => expect(skeletons()).toBe(0));
				const fast = summaryText();

				const button = fullCalculationButton();
				await waitFor(() => expect(button).toHaveProperty('disabled', false));
				fireEvent.click(button);

				// The cards drop to skeletons for the duration, so the settled state has
				// to be waited for before the figures can be compared -- reading them
				// mid-run would pass on the skeletons alone, whatever landed after.
				await waitFor(() => expect(button).toHaveProperty('disabled', true));
				await waitFor(() => expect(skeletons()).toBe(0));
				expect(summaryText()).not.toBe(fast);

				// And back again once anything else recalculates: the full result is a
				// one-shot, so the cards must not be left showing it.
				fireEvent.input(screen.getByLabelText('Decks'), { target: { value: '2' } });
				await waitFor(() => expect(button).toHaveProperty('disabled', false));
				fireEvent.input(screen.getByLabelText('Decks'), {
					target: { value: String(DEFAULT_CONFIG.decks) },
				});
				await waitFor(() => expect(skeletons()).toBe(0));
				await waitFor(() => expect(summaryText()).toBe(fast));
			},
			FULL_RUN_TIMEOUT_MS
		);
	});
});
