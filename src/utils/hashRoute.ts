/**
 * The five top-level views, addressed by a URL fragment (`#tables` /
 * `#bankroll` / `#play` / `#train` / `#sim`) rather than an always-mounted tab-panel pair,
 * so switching is a real navigation, the view is linkable/bookmarkable, and it
 * survives a reload.
 */

import { createSignal, onCleanup, onMount } from 'solid-js';

export type AppTab = 'tables' | 'bankroll' | 'play' | 'train' | 'sim';

function tabFromHash(hash: string): AppTab {
	if (hash === '#bankroll') return 'bankroll';
	if (hash === '#play') return 'play';
	if (hash === '#train') return 'train';
	if (hash === '#sim') return 'sim';
	return 'tables';
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
