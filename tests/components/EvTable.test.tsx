import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@solidjs/testing-library';

import EvTable from '#c/EvTable';

describe('EvTable', () => {
	it('renders baseline and delta grids for the default rule set', () => {
		render(() => <EvTable />);

		expect(screen.getByText('Baseline optimal-action EV (% of bet)')).toBeDefined();
		expect(screen.getByText(/EV delta vs\. baseline, count \+1/)).toBeDefined();

		const tables = screen.getAllByRole('table');
		expect(tables).toHaveLength(2);
		// 10 hard totals (8-17) as rows, plus 10 dealer upcards as columns.
		expect(within(tables[0]).getAllByRole('row')).toHaveLength(11);
	});

	it('shows an error instead of a table when the count is too extreme', async () => {
		render(() => <EvTable />);

		const countInput = screen.getByLabelText('Ace-Five count');
		fireEvent.input(countInput, { target: { value: '10000' } });
		fireEvent.submit(countInput.closest('form')!);

		expect(await screen.findByText(/too extreme/i)).toBeDefined();
	});
});
