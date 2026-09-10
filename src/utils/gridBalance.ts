/**
 * Balancing the last line of an auto-fit grid, for the stat bands.
 *
 * An `auto-fit` grid packs a short last line against the left edge, which
 * leaves the band looking as though it ran out of figures rather than as
 * though it wrapped. The fix is to start that line a whole number of columns
 * in, so the empty columns are split either side of it -- the figures stay on
 * the grid, and only where the line begins changes.
 *
 * It takes measuring because the column count is the one thing CSS knows and
 * cannot say: `auto-fit` resolves it from the container's own width, which no
 * media query can see. So the count is read back off the used value of
 * `grid-template-columns` and the offset set as an inline `grid-column-start`.
 */

import { createEffect, onCleanup } from 'solid-js';

/** Marks the figure a balanced line starts on -- see the stat band stylesheets. */
const LINE_START_CLASS = 'is-line-start';

/**
 * Keeps the last line of `grid` balanced as its width and its contents change.
 * `revision` is whatever changes when the cells do, so the effect reruns on a
 * new set of figures as well as on a resize.
 */
export function createBalancedLastLine(
	grid: () => HTMLElement | undefined,
	revision: () => unknown
): void {
	const apply = (element: HTMLElement) => {
		const cells = Array.from(element.children).filter(
			(child): child is HTMLElement => child instanceof HTMLElement
		);
		// The used value is a list of track sizes, one per column.
		const columns = getComputedStyle(element)
			.gridTemplateColumns.split(' ')
			.filter((track) => track !== '').length;
		const onLastLine = columns > 0 ? cells.length % columns : 0;
		// Floored, so an odd number of empty columns leaves the extra one on the
		// right -- the same side the line would have left it on anyway.
		const offset = onLastLine === 0 ? 0 : Math.floor((columns - onLastLine) / 2);
		const lineStart = cells.length - onLastLine;

		cells.forEach((cell, index) => {
			const shifted = offset > 0 && index === lineStart;
			cell.style.gridColumnStart = shifted ? String(offset + 1) : '';
			cell.classList.toggle(LINE_START_CLASS, shifted);
		});
	};

	createEffect(() => {
		const element = grid();
		revision();
		if (element === undefined) return;
		apply(element);
		// jsdom has no ResizeObserver of its own; `setupTests.ts` stubs one that
		// never fires, which leaves the measurement above as the only pass.
		const observer = new ResizeObserver(() => apply(element));
		observer.observe(element);
		onCleanup(() => observer.disconnect());
	});
}
