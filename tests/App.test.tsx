import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';

import App from '#App';
import { DEFAULT_CONFIG, loadCalculatorConfig } from '#utils/storage';

/**
 * Long enough that a queued calculation would have been dispatched if one were
 * coming -- what a case asserting none was has to wait out before it can say so.
 */
const settlingTime = () => new Promise((resolve) => setTimeout(resolve, 800));

/**
 * Switches to the Bankroll view via the header's tab strip, not the sidebar's
 * -- the sidebar carries its own "Bankroll" tab (its settings form), so the
 * two are told apart by which bar they live in.
 */
function goToBankroll(): void {
	const header = document.querySelector('.app-header');
	if (!header) throw new Error('App header not found');
	fireEvent.click(within(header).getByRole('tab', { name: /Bankroll/ }));
}

describe('App', () => {
	// The hash is real browser state, shared across tests in this file rather
	// than reset between renders, so a tab switch in one test would otherwise
	// leak into the next test's starting view.
	beforeEach(() => {
		window.location.hash = '';
	});

	// EvTable's initial render computes three exact-enumeration tables
	// (hard totals, soft totals, splits), which takes longer than the
	// default 5s timeout under jsdom.
	it('renders the application heading', () => {
		render(() => <App />);
		expect(
			screen.getByRole('heading', { name: 'Blackjack EV Calculator' })
		).toBeDefined();
	}, 20000);

	it('moves the true count on the arrow keys and recalculates at it', async () => {
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
		goToBankroll();

		const summaryText = () => document.querySelector('.ev-summary')?.textContent;
		const skeletons = () => document.querySelectorAll('.ev-summary__skeleton').length;

		// The first calculation is one the cards are waiting on, so wait it out
		// before asking what a count change does to them.
		await waitFor(() => expect(summaryText()).toBeDefined());
		await waitFor(() => expect(skeletons()).toBe(0));
		const before = summaryText();

		// Stepping the count is a Tables-view gesture, so switch back to it
		// before pressing the arrow key -- the Bankroll view ignores it. The
		// hash change that drives the switch fires as a separate browser event,
		// so it has to be waited out before the key press can rely on it.
		const header = document.querySelector('.app-header');
		if (!header) throw new Error('App header not found');
		fireEvent.click(within(header).getByRole('tab', { name: /Tables/ }));
		await waitFor(() => expect(document.querySelector('.ev-table__mode')).not.toBeNull());
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
	}, 20000);

	it('recalculates the summary cards on a Rules edit made while Bankroll is on screen', async () => {
		render(() => <App />);
		goToBankroll();

		const summaryText = () => document.querySelector('.ev-summary')?.textContent;
		const skeletons = () => document.querySelectorAll('.ev-summary__skeleton').length;

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
	}, 20000);

	describe('the full calculation button', () => {
		const requests = () =>
			vi.spyOn(
				globalThis.Worker.prototype as { postMessage: (data: unknown) => void },
				'postMessage'
			);

		it('dispatches a full request, and goes back to fast on the next edit', async () => {
			const postMessage = requests();
			render(() => <App />);

			// The calculation the app mounts with, which is always the fast one.
			expect(postMessage).toHaveBeenCalledTimes(1);
			expect(postMessage.mock.calls[0][0]).toMatchObject({ precision: 'fast' });
			postMessage.mockClear();

			// The button is disabled for the whole of a calculation, mount's
			// included, so the first one has to land before it can be pressed.
			const button = screen.getByRole('button', { name: 'Run full calculation' });
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
		}, 30000);

		it('moves the bankroll figures, and puts them back on the next fast result', async () => {
			// Every bankroll figure is derived from the average, so a full run has to
			// reach the summary basis the cards read -- which it does not do by
			// changing any setting, since it re-dispatches the ones already entered.
			render(() => <App />);
			goToBankroll();

			const summaryText = () => document.querySelector('.ev-summary')?.textContent;
			const skeletons = () => document.querySelectorAll('.ev-summary__skeleton').length;

			await waitFor(() => expect(summaryText()).toBeDefined());
			await waitFor(() => expect(skeletons()).toBe(0));
			const fast = summaryText();

			const button = screen.getByRole('button', { name: 'Run full calculation' });
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
		}, 30000);
	});
});
