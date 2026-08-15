/**
 * The mutable shoe every model draws against.
 *
 * Draws are made by decrementing a rank in `comp` and restoring it on the way back
 * out rather than by copying the composition at every node, so nothing may hold a
 * reference to `comp` across a recursive call and every path out of a draw loop
 * must leave it as it found it. `comp`'s identity never changes, which is what
 * lets each model capture the array once and read it as a plain local.
 */

import { CARD_UNITS, RANKS } from './cards';
import type { Composition } from './composition';

export class Shoe {
	readonly comp = new Int32Array(RANKS.length);
	private rootKey: string | null = null;

	/**
	 * Points the shoe at a root composition. Returns true when that replaces a
	 * *different* root, i.e. when caches keyed on removals from the old one have
	 * gone stale; false when the root is unchanged or is being set for the first
	 * time.
	 */
	setRoot(comp0: Composition): boolean {
		const key = comp0.join(',');
		if (this.rootKey === key) return false;
		const stale = this.rootKey !== null;
		this.rootKey = key;
		this.comp.set(comp0);
		return stale;
	}

	/** Half-card units left once the dealer's upcard is off the shoe. */
	totCardsAfterUpcard(): number {
		let sum = 0;
		for (let index = 0; index < RANKS.length; index += 1) sum += this.comp[index];
		return sum - CARD_UNITS;
	}
}
