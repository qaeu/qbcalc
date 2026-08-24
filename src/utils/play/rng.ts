/**
 * The one seeded random source the app deals from. Small and fast, which is all
 * a shuffle needs, and seeded so that a simulated shoe -- `countRounds.ts` --
 * and a played one -- `play/shoe.ts` -- are both reproducible.
 */

/** Mulberry32: 32 bits of state, one multiply-xor round per number. */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
