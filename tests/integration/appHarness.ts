import { vi } from 'vitest';
import { fireEvent, screen, within } from '@solidjs/testing-library';

import type { EvWorkerRequest } from '#utils/evWorkerProtocol';

/**
 * The pieces every App-level test needs: the real worker and the real engine run
 * behind these cases, so they drive the app through the header, the sidebar and
 * the viewport the way a user would rather than through props.
 */

/**
 * Long enough that a queued calculation would have been dispatched if one were
 * coming -- what a case asserting none was has to wait out before it can say so.
 */
export const settlingTime = () => new Promise((resolve) => setTimeout(resolve, 800));

/** The app's own header, which every view switch goes through. */
function appHeader(): HTMLElement {
	const header = document.querySelector<HTMLElement>('.app-header');
	if (!header) throw new Error('App header not found');
	return header;
}

/**
 * Switches to the Bankroll view via the header's tab strip, not the sidebar's
 * -- the sidebar carries its own "Bankroll" tab (its settings form), so the
 * two are told apart by which bar they live in.
 */
export function goToBankroll(): void {
	fireEvent.click(within(appHeader()).getByRole('tab', { name: /Bankroll/ }));
}

/** As `goToBankroll`, for the first view. */
export function goToTables(): void {
	fireEvent.click(within(appHeader()).getByRole('tab', { name: /Tables/ }));
}

/** As `goToBankroll`, for the third view. */
export function goToPlay(): void {
	fireEvent.click(within(appHeader()).getByRole('tab', { name: /Play/ }));
}

/** As `goToBankroll`, for the fourth view. */
export function goToSim(): void {
	fireEvent.click(within(appHeader()).getByRole('tab', { name: /Sim/ }));
}

/** The Bankroll view's cards, and the placeholders they show while recomputing. */
export const summaryText = () => document.querySelector('.ev-summary')?.textContent;
export const skeletons = () => document.querySelectorAll('.ev-summary__skeleton').length;

/** The sidebar's deliberate full-precision run. */
export const fullCalculationButton = () =>
	screen.getByRole('button', { name: 'Run full calculation' });

/**
 * Every request the app puts on the worker. The only place a skipped or
 * repriced calculation is visible: nothing else about the app differs between
 * recomputing a count and never having left it.
 */
export const spyOnWorkerRequests = () =>
	vi.spyOn(
		globalThis.Worker.prototype as { postMessage: (data: unknown) => void },
		'postMessage'
	);

/**
 * What such a spy recorded, as EV requests. Handy where the app has a second
 * caller on the worker -- the Play view asks for grids of its own as the felt
 * moves -- so a case can name the request it means rather than the first one.
 */
export const workerRequests = (
	spy: ReturnType<typeof spyOnWorkerRequests>
): EvWorkerRequest[] => spy.mock.calls.map((call) => call[0] as EvWorkerRequest);

/**
 * Answers media queries against a made-up viewport, understanding the two
 * features the app asks about. jsdom's own `matchMedia` answers `false` to
 * everything, so a test that does not call this exercises the desktop tree.
 */
export function stubViewport(width: number, height: number): void {
	window.matchMedia = ((query: string) => {
		const matches = query.split(',').some((clause) => {
			const maxWidth = /\(max-width:\s*(\d+)px\)/.exec(clause);
			if (maxWidth) return width <= Number(maxWidth[1]);
			const maxHeight = /\(max-height:\s*(\d+)px\)/.exec(clause);
			if (maxHeight) return height <= Number(maxHeight[1]);
			return false;
		});
		return {
			matches,
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
		} as unknown as MediaQueryList;
	}) as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

/**
 * Resets the browser state these tests share. The hash is real browser state,
 * not reset between renders, so a tab switch in one test would otherwise leak
 * into the next test's starting view; `stubViewport` outlives its test the same
 * way. Call from a `beforeEach`.
 */
export function resetBrowserState(): void {
	window.location.hash = '';
	window.matchMedia = originalMatchMedia;
}

/**
 * EvTable's initial render computes three exact-enumeration tables (hard totals,
 * soft totals, splits), which takes longer than the default 5s timeout under
 * jsdom.
 */
export const MOUNT_TIMEOUT_MS = 20_000;

/** As `MOUNT_TIMEOUT_MS`, for a case that also waits out a full-precision run. */
export const FULL_RUN_TIMEOUT_MS = 30_000;

/**
 * As `MOUNT_TIMEOUT_MS`, for a case that also deals a simulated session. The sim
 * runs its own worker in chunks across the event loop, so even a deliberately
 * tiny run costs several turns on top of the mount.
 */
export const SIM_RUN_TIMEOUT_MS = 30_000;
