import { describe, it, expect } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import App from '#App';

describe('App', () => {
	it('renders the application heading', () => {
		render(() => <App />);
		expect(screen.getByRole('heading', { name: 'Blackjack EV Calculator' })).toBeDefined();
	});
});
