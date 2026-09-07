/**
 * What a simulated session is set to: how many hands, how well they are played,
 * and what the table around them looks like. The rules, the counting system and
 * the bet ramp are not here -- those come from the sidebar, which is what makes a
 * sim result a statement about the game the rest of the app is describing. See
 * docs/sim-model.md.
 */

/**
 * How far the policy departs from basic strategy:
 *
 * - `basic` plays the unadjusted full-shoe grids and never deviates, and never
 *   takes insurance.
 * - `i18` plays those same grids with the Illustrious 18 laid over them, which is
 *   what a counter who has learnt a card's worth of indices actually plays.
 * - `full` plays the count-adjusted grids outright: the engine's own index at
 *   every cell, which is the ceiling the Play view's coach grades against.
 */
export type DeviationMode = 'basic' | 'i18' | 'full';

export interface SimConfig {
	/**
	 * Rounds dealt at the table, whether or not the player wagers on them. It is
	 * the *session* that is being sized, not the action in it: a back-counter who
	 * plays one shoe in nine has still stood at the table for all nine, and what
	 * that waiting costs is one of the things a sim is for.
	 */
	rounds: number;
	deviations: DeviationMode;
	/** Decks of uniform jitter either side of the cut card; 0 pins it exactly. */
	cutCardVarianceDecks: number;
	/**
	 * Hi-Lo-equivalent true count the player sits *down* at -- the back-counter's
	 * entry point. At the floor of the range it never bites and the player is
	 * seated from the first round.
	 */
	wongInCount: number;
	/**
	 * And the count they get *up* below again, once seated. The pair is read with
	 * hysteresis, which is the only way the two can differ: a counter who sits
	 * down at +2 stays in the seat as the shoe cools, and leaves it only when the
	 * count falls under this. At the floor of the range there is no separate exit
	 * and `wongInCount` serves as both, which is the round-by-round reading.
	 * Deliberately not constrained against `wongInCount`: an exit set above the
	 * entry is measured rather than refused, and simply wins -- see `wongCounts`
	 * in run.ts.
	 */
	wongOutCount: number;
	/** Other players at the table, whose cards are burned between rounds. */
	otherSpots: number;
	/** The shuffle seed, so a run is reproducible from its figures alone. */
	seed: number;
	/** Whether each run draws a new seed rather than replaying the stored one. */
	reseedEachRun: boolean;
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
	rounds: 50_000,
	deviations: 'i18',
	cutCardVarianceDecks: 0,
	wongInCount: -10,
	wongOutCount: -10,
	otherSpots: 0,
	seed: 1,
	reseedEachRun: true,
};

/**
 * The sentinel at the foot of both wong settings, meaning "no limit at all". It
 * is read as *never*, not as -10: a shoe dealt to the cut card reaches past ten
 * often enough that a literal reading would sit out a handful of rounds in a run
 * that asked to play every one of them. On `wongInCount` it means the player
 * never waits to sit down; on `wongOutCount`, that they hold the seat down to
 * the count they took it at. Both read as "Never" in the form.
 */
export const WONG_LIMIT = 10;

interface SimOption<T> {
	value: T;
	label: string;
}

/**
 * Round counts the form offers. The play stack deals in microseconds a round
 * (see the throughput case in tests/utils/benchmarks.test.ts), so the top of
 * this range is tens of seconds rather than minutes -- and the bottom is there
 * for checking a configuration before committing to one.
 */
export const ROUND_COUNTS: readonly SimOption<number>[] = [
	{ value: 1_000, label: '1,000' },
	{ value: 10_000, label: '10,000' },
	{ value: 50_000, label: '50,000' },
	{ value: 100_000, label: '100,000' },
	{ value: 500_000, label: '500,000' },
	{ value: 1_000_000, label: '1,000,000' },
];

export const DEVIATION_MODES: readonly SimOption<DeviationMode>[] = [
	{ value: 'basic', label: 'Basic strategy' },
	{ value: 'i18', label: 'Illustrious 18' },
	{ value: 'full', label: 'Full indices' },
];

/** Cut-card jitter, in decks either side of the nominal penetration. */
export const CUT_CARD_VARIANCES: readonly SimOption<number>[] = [
	{ value: 0, label: 'None' },
	{ value: 0.25, label: '±¼ deck' },
	{ value: 0.5, label: '±½ deck' },
	{ value: 1, label: '±1 deck' },
];

/** Where a back-counter sits down. The floor never bites. */
export const WONG_IN_COUNTS: readonly SimOption<number>[] = [
	{ value: -WONG_LIMIT, label: 'Never (play all)' },
	{ value: 0, label: '0 or better' },
	{ value: 1, label: '+1 or better' },
	{ value: 2, label: '+2 or better' },
	{ value: 3, label: '+3 or better' },
];

/** And where they get up again, having sat down. The floor never bites. */
export const WONG_OUT_COUNTS: readonly SimOption<number>[] = [
	{ value: -WONG_LIMIT, label: 'Never (hold the seat)' },
	{ value: -3, label: 'Below -3' },
	{ value: -2, label: 'Below -2' },
	{ value: -1, label: 'Below -1' },
	{ value: 0, label: 'Below 0' },
];

/** How many other players share the table, in cards burned per round. */
export const OTHER_SPOTS: readonly SimOption<number>[] = [
	{ value: 0, label: 'Heads up' },
	{ value: 1, label: '1 other' },
	{ value: 2, label: '2 others' },
	{ value: 3, label: '3 others' },
	{ value: 5, label: '5 others' },
];

/** Whether a stored or posted value is one of the options a list offers. */
export function isSimOption<T>(
	options: readonly SimOption<T>[],
	value: unknown
): boolean {
	return options.some((option) => option.value === value);
}
