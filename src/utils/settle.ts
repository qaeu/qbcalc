/**
 * How long an input waits to stop moving before a calculation is queued.
 *
 * Exact enumeration over the full shoe costs seconds, so nothing that a user
 * can move in a burst -- typing a deck count, dragging a slider, sweeping the
 * count up with a held arrow key -- may fire one per event. Long enough to
 * swallow such a burst, short enough that a single deliberate change still
 * feels like a direct response to it.
 *
 * One figure for every input rather than one per control: two different delays
 * would make the app feel differently responsive depending on which setting was
 * touched, for no reason a user could see.
 */
export const INPUT_SETTLE_MS = 500;
