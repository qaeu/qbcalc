/**
 * The one seeded random source the app deals from. Small and fast, which is all
 * a shuffle needs, and seeded so that a simulated shoe -- `countRounds.ts` --
 * and a played one -- `play/shoe.ts` -- are both reproducible.
 */

/**
 * A seeded stream of numbers in [0, 1). Callable as the bare function it has
 * always been; `state()` is there so a stream can be put down and picked up
 * again -- a shoe that survives a reload has to keep dealing what it would have.
 */
export interface SeededRandom {
	(): number;
	/** The generator's whole state. `mulberry32(random.state())` resumes it exactly. */
	state(): number;
}

/** Mulberry32: 32 bits of state, one multiply-xor round per number. */
export function mulberry32(seed: number): SeededRandom {
	let state = seed >>> 0;
	const next = (): number => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	// The state *is* the seed of the same stream, 32 bits and nothing else, so a
	// resumed generator is the original one rather than a copy that resembles it.
	return Object.assign(next, { state: () => state });
}
