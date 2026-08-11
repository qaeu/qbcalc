import { describe, it, expect, vi } from 'vitest';
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@solidjs/testing-library';

import EvTable from '#c/EvTable';

// Rendering runs three exact-enumeration tables (hard totals, soft totals,
// splits) per mount (~5-6s under jsdom, computed via a shared engine); tests
// that mount and/or recompute more than once need headroom above the
// default 5s.
vi.setConfig({ testTimeout: 20000 });

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
	it('renders hard totals, soft totals, and splits grids for the default rule set', () => {
		render(() => <EvTable />);

		expect(screen.getByText('Hard totals')).toBeDefined();
		expect(screen.getByText('Soft totals')).toBeDefined();
		expect(screen.getByText('Splits')).toBeDefined();

		const tables = screen.getAllByRole('table');
		expect(tables).toHaveLength(3);
		// 10 hard totals (8-17) as rows, plus 10 dealer upcards as columns.
		expect(within(tables[0]).getAllByRole('row')).toHaveLength(11);
		// 8 soft totals (A,2-A,9) as rows.
		expect(within(tables[1]).getAllByRole('row')).toHaveLength(9);
		// 10 splittable pairs (2,2-A,A) as rows.
		expect(within(tables[2]).getAllByRole('row')).toHaveLength(11);
	});

	it(
		'shows an error instead of a table when the count is too extreme',
		async () => {
			render(() => <EvTable />);

			const countInput = screen.getByLabelText('Ace-Five count');
			fireEvent.input(countInput, { target: { value: '10000' } });
			fireEvent.submit(countInput.closest('form')!);

			// The initial mount's own (valid) calculation is still in flight on
			// the worker stub's microtask queue ahead of this one and must finish
			// first (~5-6s under jsdom), so this needs more than findByText's 1s
			// default -- and the test itself needs more than the file's default
			// 20s budget to have room for that wait.
			expect(await screen.findByText(/too extreme/i, {}, { timeout: 25000 })).toBeDefined();
		},
		30000
	);

	it('shows a loading placeholder in cells while computing, then the optimal play as a single letter, and EV, delta, and bust odds when hovered', async () => {
		render(() => <EvTable />);

		const tables = screen.getAllByRole('table');
		const firstDataCell = () =>
			within(tables[0]).getAllByRole('row')[1].querySelectorAll('td')[0];

		expect(firstDataCell().classList.contains('is-loading')).toBe(true);

		await waitFor(() => {
			expect(firstDataCell().textContent).toMatch(/^[HSD]$/);
		});

		fireEvent.pointerEnter(firstDataCell());

		const popover = popoverFor(firstDataCell());
		await waitFor(() => {
			expect(popover.hidden).toBe(false);
		});

		expect(popover.textContent).toMatch(/Optimal-action EV:/);
		expect(popover.textContent).toMatch(/Δ vs\. baseline:/);
		expect(popover.textContent).not.toMatch(/Optimal play:/);
		expect(popover.textContent).toMatch(/Player bust% on hit: \d+\.\d%/);
		expect(popover.textContent).toMatch(/Dealer bust%: \d+\.\d%/);
	});

	it('keeps the popover open when the pointer moves onto it, and hides it once the pointer leaves both', async () => {
		render(() => <EvTable />);

		const tables = screen.getAllByRole('table');
		const firstDataCell = () =>
			within(tables[0]).getAllByRole('row')[1].querySelectorAll('td')[0];
		await waitFor(() => {
			expect(firstDataCell().textContent).toMatch(/^[HSD]$/);
		});

		fireEvent.pointerEnter(firstDataCell());

		const popover = popoverFor(firstDataCell());
		await waitFor(() => {
			expect(popover.hidden).toBe(false);
		});

		fireEvent.pointerLeave(firstDataCell());
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

	it('persists the config to localStorage on Calculate, and restores it on the next mount', async () => {
		render(() => <EvTable />);

		const decksInput = screen.getByLabelText('Decks');
		fireEvent.input(decksInput, { target: { value: '6' } });
		const countInput = screen.getByLabelText('Ace-Five count');
		fireEvent.input(countInput, { target: { value: '-2' } });
		const checkbox = screen.getByLabelText('S17') as HTMLInputElement;
		fireEvent.click(checkbox);
		fireEvent.submit(decksInput.closest('form')!);

		expect(await screen.findByText('Hard totals')).toBeDefined();

		cleanup();
		render(() => <EvTable />);

		expect((screen.getByLabelText('Decks') as HTMLInputElement).value).toBe('6');
		expect((screen.getByLabelText('Ace-Five count') as HTMLInputElement).value).toBe(
			'-2'
		);
		expect((screen.getByLabelText('S17') as HTMLInputElement).checked).toBe(true);
		expect(screen.getByText('Hard totals')).toBeDefined();
	});

	it('recomputes cell values when the S17 checkbox is toggled', async () => {
		render(() => <EvTable />);

		const cell = () =>
			within(screen.getAllByRole('table')[0])
				.getAllByRole('row')[10]
				.querySelectorAll('td')[0];

		await waitFor(() => {
			expect(cell().textContent).toMatch(/^[HSD]$/);
		});

		fireEvent.pointerEnter(cell());
		const popoverBefore = popoverFor(cell());
		await waitFor(() => expect(popoverBefore.hidden).toBe(false));
		const textBefore = popoverBefore.textContent;

		const checkbox = screen.getByLabelText('S17') as HTMLInputElement;
		fireEvent.click(checkbox);
		fireEvent.submit(checkbox.closest('form')!);

		await waitFor(() => {
			expect(popoverFor(cell()).textContent).not.toEqual(textBefore);
		});
	});
});
