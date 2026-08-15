import { onCleanup, onMount } from 'solid-js';

/**
 * Elements a key press belongs to before it belongs to the page. A shortcut
 * registered through `createGlobalKeydown` has to step aside for these or it
 * would swallow space on the Calculate button, on the counting-system select,
 * and inside the drill-down dialog -- each of which the browser or Ark UI has
 * already given the key a meaning in.
 */
const KEY_CONSUMING_SELECTOR = [
	'button',
	'input',
	'textarea',
	'select',
	'[contenteditable]',
	'[role="combobox"]',
	'[role="dialog"]',
	'[role="tab"]',
].join(',');

/**
 * Whether the key press landed somewhere that already has its own use for the
 * key. Grid cells are deliberately absent from the list: space cycles the
 * table's display mode even with a cell focused, and the cell keeps Enter for
 * its drill-down.
 */
export function isKeyConsumingTarget(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(KEY_CONSUMING_SELECTOR) !== null;
}

/**
 * One document-level keydown listener, torn down with the owning component.
 * Shared rather than hand-rolled per shortcut so the handlers stay in one
 * place as more of them arrive.
 */
export function createGlobalKeydown(handler: (event: KeyboardEvent) => void): void {
	onMount(() => {
		document.addEventListener('keydown', handler);
		onCleanup(() => document.removeEventListener('keydown', handler));
	});
}
