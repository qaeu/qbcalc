import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';

import EvTable from '#c/EvTable';

// The HoverCard content isn't unmounted while closed (it's hidden via the
// `hidden` attribute instead), so look it up by the id HoverCard pairs with
// the trigger rather than trusting DOM order across the whole 10x10 grid.
function popoverFor(trigger: Element): HTMLElement {
	const contentId = trigger.id.replace(/:trigger$/, ':content');
	const content = document.getElementById(contentId);
	if (!content) throw new Error(`No popover content found for trigger #${trigger.id}`);
	return content;
}

describe('EvTable', () => {
	it('renders a single EV grid for the default rule set', () => {
		render(() => <EvTable />);

		expect(screen.getByText('Optimal-action EV, count +1 (% of bet)')).toBeDefined();

		const tables = screen.getAllByRole('table');
		expect(tables).toHaveLength(1);
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

	it('shows baseline, delta, optimal play, and bust odds when a cell is hovered', async () => {
		render(() => <EvTable />);

		const tables = screen.getAllByRole('table');
		const firstDataCell = within(tables[0])
			.getAllByRole('row')[1]
			.querySelectorAll('td')[0];
		fireEvent.pointerEnter(firstDataCell);

		const popover = popoverFor(firstDataCell);
		await waitFor(() => {
			expect(popover.hidden).toBe(false);
		});

		expect(popover.textContent).toMatch(/Baseline EV:/);
		expect(popover.textContent).toMatch(/Δ vs\. baseline:/);
		expect(popover.textContent).toMatch(/Optimal play: (Hit|Stand|Double)/);
		expect(popover.textContent).toMatch(/Player bust% on hit: \d+\.\d%/);
		expect(popover.textContent).toMatch(/Dealer bust%: \d+\.\d%/);
	});

	it('keeps the popover open when the pointer moves onto it, and hides it once the pointer leaves both', async () => {
		render(() => <EvTable />);

		const tables = screen.getAllByRole('table');
		const firstDataCell = within(tables[0])
			.getAllByRole('row')[1]
			.querySelectorAll('td')[0];
		fireEvent.pointerEnter(firstDataCell);

		const popover = popoverFor(firstDataCell);
		await waitFor(() => {
			expect(popover.hidden).toBe(false);
		});

		fireEvent.pointerLeave(firstDataCell);
		fireEvent.pointerEnter(popover);

		expect(popover.hidden).toBe(false);

		fireEvent.pointerLeave(popover);

		await waitFor(() => {
			expect(popover.hidden).toBe(true);
		});
	});

	it('shows the calculation duration next to the Calculate button', async () => {
		render(() => <EvTable />);

		const form = screen.getByLabelText('Ace-Five count').closest('form')!;
		fireEvent.submit(form);

		expect(await screen.findByText(/\(took \d+\.\d+s\)/)).toBeDefined();
	});

	it('recomputes cell values when the S17 checkbox is toggled', async () => {
		render(() => <EvTable />);

		const tables = screen.getAllByRole('table');
		const cellBefore = within(tables[0])
			.getAllByRole('row')[10]
			.querySelectorAll('td')[0].textContent;

		const checkbox = screen.getByLabelText('S17') as HTMLInputElement;
		fireEvent.click(checkbox);
		fireEvent.submit(checkbox.closest('form')!);

		await waitFor(() => {
			const cellAfter = within(screen.getAllByRole('table')[0])
				.getAllByRole('row')[10]
				.querySelectorAll('td')[0].textContent;
			expect(cellAfter).not.toEqual(cellBefore);
		});
	});
});
