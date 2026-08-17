/**
 * The two top-level views, addressed by a URL fragment (`#tables` /
 * `#bankroll`) rather than an always-mounted tab-panel pair, so switching is a
 * real navigation, the view is linkable/bookmarkable, and it survives a
 * reload.
 */

import { createSignal, onCleanup, onMount } from 'solid-js';

export type AppTab = 'tables' | 'bankroll';

function tabFromHash(hash: string): AppTab {
	return hash === '#bankroll' ? 'bankroll' : 'tables';
}

/**
 * A signal wired to `window.location.hash`. Listens for `hashchange` (covers
 * back/forward navigation) and exposes a setter that writes the hash directly
 * -- a plain assignment, not `pushState` -- so back/forward keeps working for
 * free.
 */
export function createHashRoute(): [() => AppTab, (tab: AppTab) => void] {
	const [tab, setTabSignal] = createSignal<AppTab>(tabFromHash(window.location.hash));

	const onHashChange = () => setTabSignal(tabFromHash(window.location.hash));

	onMount(() => {
		window.addEventListener('hashchange', onHashChange);
		onCleanup(() => window.removeEventListener('hashchange', onHashChange));
	});

	const setTab = (tab: AppTab) => {
		window.location.hash = `#${tab}`;
	};

	return [tab, setTab];
}
