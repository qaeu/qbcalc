import type { PlayerAction } from '#utils/blackjackEv';

/** Grid cell fill class for each optimal action, shared with the cell popover. */
export const ACTION_CLASS: Record<PlayerAction, string> = {
	H: 'is-hit',
	S: 'is-stand',
	D: 'is-double',
	P: 'is-split',
	R: 'is-surrender',
};
