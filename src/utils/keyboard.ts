import { onCleanup, onMount } from 'solid-js';

/**
 * Elements a key press belongs to before it belongs to the page. A shortcut
 * registered through `createGlobalKeydown` has to step aside for these or it
 * would swallow space on the counting-system select, the tab strip, and inside
 * the drill-down dialog -- each of which the browser or Ark UI has already
 * given the key a meaning in.
 */
const KEY_CONSUMING_SELECTOR = [
	'input',
	'textarea',
	'select',
	'[contenteditable]',
	'[role="combobox"]',
	'[role="dialog"]',
	'[role="tab"]',
].join(',');

/**
 * Buttons, which consume a key press for every caller but one. The Play view's
 * action bar binds the number keys to the same actions its buttons fire, so a
 * focused button there must not swallow the shortcut that just pressed it.
 */
const BUTTON_SELECTOR = 'button';

/**
 * Whether the key press landed somewhere that already has its own use for the
 * key. Grid cells are deliberately absent from the list: space cycles the
 * table's display mode even with a cell focused, and the cell keeps Enter for
 * its drill-down.
 *
 * `allowButtons` drops plain buttons from that list -- see `BUTTON_SELECTOR`.
 * Everything else still consumes as it did.
 */
export function isKeyConsumingTarget(
	target: EventTarget | null,
	options?: { allowButtons?: boolean }
): boolean {
	if (!(target instanceof Element)) return false;
	const selector =
		options?.allowButtons === true ?
			KEY_CONSUMING_SELECTOR
		:	`${BUTTON_SELECTOR},${KEY_CONSUMING_SELECTOR}`;
	return target.closest(selector) !== null;
}

/**
 * Layers that answer Escape themselves: a dialog, and a select's trigger or its
 * open list. Escape pressed in one of them is closing it, not leaving the view.
 */
const ESCAPE_CONSUMING_SELECTOR = [
	'[role="dialog"]',
	'[role="combobox"]',
	'[role="listbox"]',
	'[role="menu"]',
].join(',');

/** Whether an Escape press belongs to a layer that closes on it -- see above. */
export function isEscapeConsumingTarget(event: KeyboardEvent): boolean {
	if (event.defaultPrevented) return true;
	return (
		event.target instanceof Element
		&& event.target.closest(ESCAPE_CONSUMING_SELECTOR) !== null
	);
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
