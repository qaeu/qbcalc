import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

import App from '#App';
import { DEFAULT_CONFIG, loadCalculatorConfig } from '#utils/storage';

/**
 * Long enough that a queued calculation would have been dispatched if one were
 * coming -- what a case asserting none was has to wait out before it can say so.
 */
const settlingTime = () => new Promise((resolve) => setTimeout(resolve, 800));

describe('App', () => {
	// EvTable's initial render computes three exact-enumeration tables
	// (hard totals, soft totals, splits), which takes longer than the
	// default 5s timeout under jsdom.
	it('renders the application heading', () => {
		render(() => <App />);
		expect(
			screen.getByRole('heading', { name: 'Blackjack EV Calculator' })
		).toBeDefined();
	}, 20000);

	it('moves the running count on the arrow keys and recalculates at it', async () => {
		render(() => <App />);

		const countLine = () => document.querySelector('.ev-table__mode')?.textContent;
		expect(countLine()).toContain('Running count 0');

		fireEvent.keyDown(document.body, { key: 'ArrowUp' });
		fireEvent.keyDown(document.body, { key: 'ArrowUp' });
		// The reading follows the key immediately; the calculation behind it
		// waits for the keys to settle, so a two-key sweep is one request.
		expect(countLine()).toContain('Running count +2');

		fireEvent.keyDown(document.body, { key: 'ArrowDown' });
		expect(countLine()).toContain('Running count +1');

		// The arrow keys belong to a number input before they belong to the
		// count, the same way space does to a button.
		fireEvent.keyDown(screen.getByLabelText('Decks'), { key: 'ArrowUp' });
		expect(countLine()).toContain('Running count +1');

		// Persisted like any other input, even though it never passes through
		// the settings form.
		await waitFor(() =>
			expect(loadCalculatorConfig()).toEqual({ ...DEFAULT_CONFIG, count: 1 })
		);
	}, 20000);

	it('drops the queued recalculation when the count comes back to where it started', async () => {
		// The one place a skipped calculation is visible: nothing else about the
		// app differs between recomputing this count and never having left it.
		const postMessage = vi.spyOn(
			globalThis.Worker.prototype as { postMessage: (data: unknown) => void },
			'postMessage'
		);

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
	}, 20000);

	it('recalculates once the settings settle, with no button to press', async () => {
		render(() => <App />);

		expect(screen.queryByRole('button', { name: 'Calculate' })).toBeNull();

		fireEvent.input(screen.getByLabelText('Decks'), { target: { value: '2' } });

		await waitFor(() =>
			expect(loadCalculatorConfig()).toEqual({ ...DEFAULT_CONFIG, decks: 2 })
		);
	}, 20000);

	it('leaves the summary cards alone while the count recalculates', async () => {
		render(() => <App />);

		const summaryText = () => document.querySelector('.ev-summary')?.textContent;
		const skeletons = () => document.querySelectorAll('.ev-summary__skeleton').length;

		// The first calculation is one the cards are waiting on, so wait it out
		// before asking what a count change does to them.
		await waitFor(() => expect(skeletons()).toBe(0));
		const before = summaryText();

		fireEvent.keyDown(document.body, { key: 'ArrowUp' });
		await waitFor(() =>
			expect(loadCalculatorConfig()).toEqual({ ...DEFAULT_CONFIG, count: 1 })
		);

		// Neither blanked mid-recalculation nor re-derived from the new count:
		// these figures describe the whole shoe, not the hand in front of you.
		expect(skeletons()).toBe(0);
		expect(summaryText()).toBe(before);
	}, 20000);
});
