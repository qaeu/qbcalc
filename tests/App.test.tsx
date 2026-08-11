import { describe, it, expect } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import App from '#App';

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
});
