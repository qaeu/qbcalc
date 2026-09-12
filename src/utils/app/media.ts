/**
 * Media queries as signals, for the handful of layout decisions CSS cannot
 * make on its own -- which component tree to mount, rather than how to draw
 * one that is already there. Everything that *can* stay in CSS does: see the
 * `compact`, `phone` and `touch` mixins in `styles/_theme.scss`.
 */

import { createSignal, onCleanup, type Accessor } from 'solid-js';

/**
 * Narrow *or* short. A phone in landscape clears the tablet breakpoint on width
 * while having less height than a settings card needs, so the compact layout
 * keys off both. Kept in sync by hand with the `compact` mixin in
 * `styles/_theme.scss` -- change one, change the other.
 */
export const COMPACT_LAYOUT_QUERY = '(max-width: 800px), (max-height: 600px)';

/**
 * Tracks `query` as a signal, seeded from its current state and updated as the
 * viewport moves. Falls back to a constant `false` where `matchMedia` is
 * missing, which is what keeps the desktop tree the one every non-browser
 * environment renders.
 */
export function createMediaQuery(query: string): Accessor<boolean> {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		return () => false;
	}
	const list = window.matchMedia(query);
	const [matches, setMatches] = createSignal(list.matches);
	const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
	// `addListener` is the pre-2020 spelling, and Safari was the last to carry
	// only it. Worth the fallback here rather than anywhere else in the app: a
	// stale reading of this particular signal strands the settings behind a
	// button that is no longer rendered.
	if (typeof list.addEventListener === 'function') {
		list.addEventListener('change', onChange);
		onCleanup(() => list.removeEventListener('change', onChange));
	} else {
		list.addListener(onChange);
		onCleanup(() => list.removeListener(onChange));
	}
	return matches;
}
