/**
 * Counting system presets for the settings UI.
 *
 * Kept out of `ev/` so the engine stays a pure tag-vector consumer with no
 * notion of named systems; it only carries `ACE_FIVE_TAGS` as its own default.
 *
 * A preset is only ever its tag vector, so systems that differ from a listed
 * one only in how the player uses it -- REKO is KO with simpler key counts, on
 * identical tags -- earn no entry of their own.
 */

import { ACE_FIVE_TAGS, type TagValues } from './ev/composition';

export type CountingSystemId =
	'ace-five' | 'hi-lo' | 'ko' | 'hi-opt-i' | 'uston-apm' | 'custom';

export interface CountingSystem {
	id: CountingSystemId;
	label: string;
	/** `null` for 'custom', whose tags are whatever the user typed. */
	tags: TagValues | null;
}

/** Builds a tag vector from the ranks that are not neutral. */
function tags(nonNeutral: Partial<TagValues>): TagValues {
	return {
		'2': 0,
		'3': 0,
		'4': 0,
		'5': 0,
		'6': 0,
		'7': 0,
		'8': 0,
		'9': 0,
		T: 0,
		A: 0,
		...nonNeutral,
	};
}

export const COUNTING_SYSTEMS: readonly CountingSystem[] = [
	{ id: 'ace-five', label: 'Ace-Five', tags: ACE_FIVE_TAGS },
	{
		id: 'hi-lo',
		label: 'Hi-Lo',
		tags: tags({ '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, T: -1, A: -1 }),
	},
	{
		id: 'ko',
		label: 'KO',
		tags: tags({ '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, T: -1, A: -1 }),
	},
	{
		id: 'hi-opt-i',
		label: 'Hi-Opt I',
		tags: tags({ '3': 1, '4': 1, '5': 1, '6': 1, T: -1 }),
	},
	{
		id: 'uston-apm',
		label: 'Uston APM',
		tags: tags({ '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, T: -1, A: -1 }),
	},
	{ id: 'custom', label: 'Custom', tags: null },
];

export function isCountingSystemId(value: unknown): value is CountingSystemId {
	return COUNTING_SYSTEMS.some((system) => system.id === value);
}

/** The preset's tag values, or `null` if the system has no fixed tags. */
export function tagsForSystem(id: CountingSystemId): TagValues | null {
	return COUNTING_SYSTEMS.find((system) => system.id === id)?.tags ?? null;
}
