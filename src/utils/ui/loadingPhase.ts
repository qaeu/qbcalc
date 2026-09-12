export const LOADING_PHASE_COUNT = 12;

const PHASE_HASH_PRIME = 2654435761;

/**
 * Scatters a loading skeleton across the pulse cycle so a set of them twinkle
 * independently instead of sweeping as a wave. Hashed rather than drawn per
 * skeleton so it keeps its phase across re-renders; the seed carries the
 * per-run randomness (and, where there are several distinct grids of
 * skeletons on screen, a per-grid salt so they don't repeat one pattern).
 */
export function loadingPhase(seed: number, rowIndex: number, colIndex: number): number {
	let hash = Math.imul(seed ^ PHASE_HASH_PRIME, PHASE_HASH_PRIME);
	hash = Math.imul(hash ^ (rowIndex * 31 + colIndex + 1), PHASE_HASH_PRIME);
	// Without this avalanche round adjacent cells collide ~38% more often than
	// chance, which reads as visible clumping rather than an even twinkle.
	hash = Math.imul(hash ^ (hash >>> 15), PHASE_HASH_PRIME);
	return (hash >>> 16) % LOADING_PHASE_COUNT;
}
