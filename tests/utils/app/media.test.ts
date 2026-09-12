import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'solid-js';

import { COMPACT_LAYOUT_QUERY, createMediaQuery } from '#utils/app/media';

/**
 * A `matchMedia` stand-in whose matches can be moved from the test. jsdom ships
 * an implementation of its own, but an inert one -- it always reports `false`
 * and never fires a `change` -- so there is nothing there to drive.
 */
function stubMatchMedia(initial: boolean) {
	const listeners = new Set<(event: MediaQueryListEvent) => void>();
	let matches = initial;
	const list = {
		get matches() {
			return matches;
		},
		media: '',
		addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
			void listeners.add(listener),
		removeEventListener: (
			_type: string,
			listener: (event: MediaQueryListEvent) => void
		) => void listeners.delete(listener),
	};
	window.matchMedia = ((query: string) => {
		list.media = query;
		return list;
	}) as typeof window.matchMedia;
	return {
		list,
		listenerCount: () => listeners.size,
		set(next: boolean) {
			matches = next;
			for (const listener of listeners) {
				listener({ matches: next } as MediaQueryListEvent);
			}
		},
	};
}

const originalMatchMedia = window.matchMedia;
afterEach(() => {
	window.matchMedia = originalMatchMedia;
});

describe('createMediaQuery', () => {
	it('reflects the query it is handed at the moment it is created', () => {
		stubMatchMedia(true);
		createRoot((dispose) => {
			expect(createMediaQuery('(max-width: 800px)')()).toBe(true);
			dispose();
		});

		stubMatchMedia(false);
		createRoot((dispose) => {
			expect(createMediaQuery('(max-width: 800px)')()).toBe(false);
			dispose();
		});
	});

	it('follows the viewport as it moves', () => {
		const media = stubMatchMedia(false);
		createRoot((dispose) => {
			const compact = createMediaQuery(COMPACT_LAYOUT_QUERY);
			expect(compact()).toBe(false);

			media.set(true);
			expect(compact()).toBe(true);

			media.set(false);
			expect(compact()).toBe(false);
			dispose();
		});
	});

	it('detaches its listener when its owner is disposed', () => {
		const media = stubMatchMedia(false);
		let compact: (() => boolean) | undefined;
		const dispose = createRoot((disposeRoot) => {
			compact = createMediaQuery(COMPACT_LAYOUT_QUERY);
			return disposeRoot;
		});
		expect(media.listenerCount()).toBe(1);

		dispose();
		expect(media.listenerCount()).toBe(0);

		// And nothing is left listening to move: the accessor holds its last
		// value rather than tracking a viewport it no longer belongs to.
		media.set(true);
		expect(compact?.()).toBe(false);
	});

	it('falls back to a constant false where matchMedia is missing', () => {
		// @ts-expect-error -- deliberately modelling an environment without it.
		delete window.matchMedia;
		createRoot((dispose) => {
			expect(createMediaQuery(COMPACT_LAYOUT_QUERY)()).toBe(false);
			dispose();
		});
	});
});
