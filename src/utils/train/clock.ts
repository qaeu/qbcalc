/**
 * The clock a drill times each answer on: started when the last card lands (or
 * the prompt appears), stopped by the answer, and -- in a Test -- run out into a
 * miss. Ticks a signal while it runs, for the HUD's clock and countdown.
 */

import { createSignal, onCleanup } from 'solid-js';

/** How often the running clock repaints. Fine enough for a tenth of a second. */
const TICK_MS = 100;

export interface AnswerClock {
	/** Starts timing an answer, from now. */
	start(): void;
	/**
	 * Stops the clock and returns how long the answer took, capped at the limit
	 * where there is one -- a timeout costs the limit and no more.
	 */
	stop(): number;
	/** Time on the answer being given, or 0 while none is. */
	elapsed: () => number;
	running: () => boolean;
}

/**
 * `limitMs` null for an untimed drill. `onTimeout` fires once the limit passes
 * with the clock still running; it is expected to answer on the player's behalf,
 * which stops it.
 */
export function createAnswerClock(
	limitMs: number | null,
	onTimeout: () => void
): AnswerClock {
	const [startedAt, setStartedAt] = createSignal<number | null>(null);
	const [now, setNow] = createSignal(0);
	let ticker: ReturnType<typeof setInterval> | undefined;
	let timeout: ReturnType<typeof setTimeout> | undefined;

	const clear = () => {
		clearInterval(ticker);
		clearTimeout(timeout);
		ticker = undefined;
		timeout = undefined;
	};
	onCleanup(clear);

	const elapsedSince = (from: number) => {
		const elapsed = Math.max(0, Date.now() - from);
		return limitMs === null ? elapsed : Math.min(elapsed, limitMs);
	};

	return {
		start() {
			clear();
			const from = Date.now();
			setNow(from);
			setStartedAt(from);
			ticker = setInterval(() => setNow(Date.now()), TICK_MS);
			if (limitMs !== null) timeout = setTimeout(onTimeout, limitMs);
		},
		stop() {
			const from = startedAt();
			clear();
			setStartedAt(null);
			return from === null ? 0 : elapsedSince(from);
		},
		elapsed: () => {
			const from = startedAt();
			if (from === null) return 0;
			// Read for the tick alone: it is what makes this reactive.
			now();
			return elapsedSince(from);
		},
		running: () => startedAt() !== null,
	};
}
