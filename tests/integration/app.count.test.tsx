import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

import App from '#App';
import { DEFAULT_CONFIG, loadCalculatorConfig } from '#utils/storage';
import {
	goToBankroll,
	goToTables,
	MOUNT_TIMEOUT_MS,
	resetBrowserState,
	settlingTime,
	skeletons,
	spyOnWorkerRequests,
	summaryText,
} from './appHarness';

describe('App', () => {
	beforeEach(resetBrowserState);

	it(
		'moves the true count on the arrow keys and recalculates at it',
		async () => {
			render(() => <App />);

			const countLine = () => document.querySelector('.ev-table__mode')?.textContent;
			expect(countLine()).toContain('True count 0');

			fireEvent.keyDown(document.body, { key: 'ArrowUp' });
			fireEvent.keyDown(document.body, { key: 'ArrowUp' });
			// The reading follows the key immediately; the calculation behind it
			// waits for the keys to settle, so a two-key sweep is one request.
			expect(countLine()).toContain('True count +2');

			fireEvent.keyDown(document.body, { key: 'ArrowDown' });
			expect(countLine()).toContain('True count +1');

			// The arrow keys belong to a number input before they belong to the
			// count, the same way space does to a button.
			fireEvent.keyDown(screen.getByLabelText('Decks'), { key: 'ArrowUp' });
			expect(countLine()).toContain('True count +1');

			// Persisted like any other input, even though it never passes through
			// the settings form.
			await waitFor(() =>
				expect(loadCalculatorConfig()).toEqual({ ...DEFAULT_CONFIG, trueCount: 1 })
			);
		},
		MOUNT_TIMEOUT_MS
	);

	it(
		'drops the queued recalculation when the count comes back to where it started',
		async () => {
			const postMessage = spyOnWorkerRequests();

			render(() => <App />);
			// The calculation the app mounts with, which is not what is being tested.
			expect(postMessage).toHaveBeenCalledTimes(1);
			postMessage.mockClear();

			fireEvent.keyDown(document.body, { key: 'ArrowUp' });
			fireEvent.keyDown(document.body, { key: 'ArrowDown' });

			await settlingTime();
			expect(postMessage).not.toHaveBeenCalled();

			// Still armed, rather than wedged by the cancellation.
			fireEvent.keyDown(document.body, { key: 'ArrowUp' });
			await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));

			postMessage.mockRestore();
		},
		MOUNT_TIMEOUT_MS
	);

	it(
		'leaves the summary cards alone while the count recalculates',
		async () => {
			render(() => <App />);
			goToBankroll();

			// The first calculation is one the cards are waiting on, so wait it out
			// before asking what a count change does to them.
			await waitFor(() => expect(summaryText()).toBeDefined());
			await waitFor(() => expect(skeletons()).toBe(0));
			const before = summaryText();

			// Stepping the count is a Tables-view gesture, so switch back to it
			// before pressing the arrow key -- the Bankroll view ignores it. The
			// hash change that drives the switch fires as a separate browser event,
			// so it has to be waited out before the key press can rely on it.
			goToTables();
			await waitFor(() =>
				expect(document.querySelector('.ev-table__mode')).not.toBeNull()
			);
			fireEvent.keyDown(document.body, { key: 'ArrowUp' });
			await waitFor(() =>
				expect(loadCalculatorConfig()).toEqual({ ...DEFAULT_CONFIG, trueCount: 1 })
			);
			goToBankroll();
			await waitFor(() => expect(summaryText()).toBeDefined());

			// Neither blanked mid-recalculation nor re-derived from the new count:
			// these figures describe the whole shoe, not the hand in front of you.
			expect(skeletons()).toBe(0);
			expect(summaryText()).toBe(before);
		},
		MOUNT_TIMEOUT_MS
	);
});
