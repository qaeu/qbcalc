import type { PlayerAction } from '#utils/ev/rules';

/**
 * Colours a signed figure by its direction. Returned as a bare state class
 * rather than a BEM one so the cell popover and the drill-down dialog can
 * share the rule while each scopes the colours to its own block.
 */
export function signClass(value: number): string | undefined {
	if (value > 0) return 'is-positive';
	if (value < 0) return 'is-negative';
	return undefined;
}

/** Grid cell fill class for each optimal action, shared with the cell popover. */
export const ACTION_CLASS: Record<PlayerAction, string> = {
	H: 'is-hit',
	S: 'is-stand',
	D: 'is-double',
	P: 'is-split',
	R: 'is-surrender',
};
