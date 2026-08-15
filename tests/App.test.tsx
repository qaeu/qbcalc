import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

import App from '#App';
import { DEFAULT_CONFIG, loadCalculatorConfig } from '#utils/storage';

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
});
