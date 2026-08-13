/**
 * Counting system presets for the settings UI.
 *
 * Kept out of `blackjackEv.ts` so the engine stays a pure tag-vector
 * consumer with no notion of named systems; it only carries `ACE_FIVE_TAGS`
 * as its own default.
 */

import { ACE_FIVE_TAGS, type TagValues } from './blackjackEv';

export type CountingSystemId = 'ace-five' | 'custom';

export interface CountingSystem {
	id: CountingSystemId;
	label: string;
	/** `null` for 'custom', whose tags are whatever the user typed. */
	tags: TagValues | null;
}

export const COUNTING_SYSTEMS: readonly CountingSystem[] = [
	{ id: 'ace-five', label: 'Ace-Five', tags: ACE_FIVE_TAGS },
	{ id: 'custom', label: 'Custom', tags: null },
];

export function isCountingSystemId(value: unknown): value is CountingSystemId {
	return COUNTING_SYSTEMS.some((system) => system.id === value);
}

/** The preset's tag values, or `null` if the system has no fixed tags. */
export function tagsForSystem(id: CountingSystemId): TagValues | null {
	return COUNTING_SYSTEMS.find((system) => system.id === id)?.tags ?? null;
}
