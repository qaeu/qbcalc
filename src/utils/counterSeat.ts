/**
 * Seats for the deviation counters on the EV board. Keep in sync with
 * $counter-seats in src/styles/EvTable.scss.
 */
export const COUNTER_SEAT_COUNT = 12;

const SEAT_HASH_PRIME = 2654435761;

/**
 * Which seat a cell's counter sits in -- how far it is turned on the cell and
 * how far it is jogged off centre. Hashed from the cell rather than drawn per
 * render, and deliberately not from the count: a piece has to keep its tilt
 * while the count moves around it and while the display mode changes under it,
 * or every counter on the board twitches each time either of them changes, and
 * no easing will make that read as anything but noise.
 *
 * The scatter itself is what stops ten counters in a row reading as a printed
 * strip: they are pieces someone put down, not a second grid.
 */
export function counterSeat(hand: string, upcard: string): number {
	const key = `${hand}-${upcard}`;
	let hash = SEAT_HASH_PRIME;
	for (let i = 0; i < key.length; i += 1) {
		hash = Math.imul(hash ^ key.charCodeAt(i), SEAT_HASH_PRIME);
	}
	// The same avalanche round `loadingPhase` takes, and for the same reason:
	// without it neighbouring cells collide far more often than chance, which
	// reads as rows of counters sharing one angle.
	hash = Math.imul(hash ^ (hash >>> 15), SEAT_HASH_PRIME);
	return (hash >>> 16) % COUNTER_SEAT_COUNT;
}
