import { describe, it, expect } from 'vitest';

import { analyzeBankroll } from '#utils/bankroll';
import { HI_LO_TAGS } from '#utils/countingSystems';
import { ROUND_TRUE_COUNTS } from '#utils/countRounds';
import { RANKS } from '#utils/ev/cards';
import { baseComposition, type TagValues } from '#utils/ev/composition';
import { ShoeEv } from '#utils/ev/engine';
import { DEFAULT_RULE_SET, type RuleSet } from '#utils/ev/rules';
import { averageEvPercent } from '#utils/ev/tables';
import { DEFAULT_SIM_CONFIG, type SimConfig } from '#utils/sim/config';
import { summarizeRun, type SimResult } from '#utils/sim/result';
import { createRun, isDone, runChunk, type SimInputs } from '#utils/sim/run';

/** A tag vector that tells no rank from another: every round is played at zero. */
const ZERO_TAGS = Object.fromEntries(RANKS.map((rank) => [rank, 0])) as TagValues;

const FLAT_RAMP = [1, 1, 1, 1, 1, 1, 1];
const SPREAD_RAMP = [1, 1, 2, 3, 5, 8, 12];

function inputs(sim: Partial<SimConfig>, overrides: Partial<SimInputs> = {}): SimInputs {
	return {
		ruleSet: DEFAULT_RULE_SET,
		tags: HI_LO_TAGS,
		sim: { ...DEFAULT_SIM_CONFIG, rounds: 2_000, ...sim },
		ramp: SPREAD_RAMP,
		unit: 25,
		roundsPerHour: 80,
		precision: 'fast',
		...overrides,
	};
}

/** A whole run, stepped in chunks the way the worker steps it. */
function play(simInputs: SimInputs, chunk = 500): SimResult {
	const run = createRun(simInputs);
	let guard = 0;
	while (!isDone(run)) {
		runChunk(run, chunk);
		if ((guard += 1) > 10_000) throw new Error('the run never finished');
	}
	return summarizeRun(run);
}

/** Comfortably past the few seconds a hundred thousand dealt rounds costs. */
const TIMEOUT_MS = 120_000;

describe('a simulated session', () => {
	const result = play(inputs({ rounds: 5_000, seed: 7 }));

	it('deals exactly the rounds it was asked for', () => {
		expect(result.roundsSeen).toBe(5_000);
		// Nothing here sits out -- no wong window, and the ramp stakes something at
		// every count -- so every round dealt is a round played.
		expect(result.roundsPlayed).toBe(5_000);
		expect(result.roundsWatched).toBe(0);
		expect(result.watchedPercent).toBe(0);
		// Splits settle more hands than rounds, never fewer.
		expect(result.hands).toBeGreaterThanOrEqual(result.roundsPlayed);
	});

	it('deals through a shoe at a time', () => {
		// Six decks at 75% is about 43 heads-up rounds, so 5,000 of them is a
		// hundred-odd shoes -- and never one shoe, which would mean the cut card
		// was never reached, nor one per round.
		expect(result.shoes).toBeGreaterThan(50);
		expect(result.shoes).toBeLessThan(result.roundsPlayed);
	});

	it('deals naturals at about the rate the deck does', () => {
		// A fresh shoe deals one about 4.75% of the time, and 5,000 rounds is loose
		// enough sampling to bracket rather than pin. Only a round's first hand can
		// hold one, so there can never be more than there were rounds played.
		expect(result.blackjacks).toBeGreaterThan(0);
		expect(result.blackjacks).toBeLessThanOrEqual(result.roundsPlayed);
		expect(result.blackjackPercent).toBeGreaterThan(3.5);
		expect(result.blackjackPercent).toBeLessThan(6);
	});

	it('files every round it saw into a bucket', () => {
		const bucketed = result.buckets.reduce((sum, bucket) => sum + bucket.rounds, 0);
		expect(bucketed).toBe(result.roundsSeen);
		expect(result.buckets).toHaveLength(ROUND_TRUE_COUNTS.length);
	});

	it('sums its buckets back to the run', () => {
		const sum = (read: (bucket: (typeof result.buckets)[number]) => number) =>
			result.buckets.reduce((total, bucket) => total + read(bucket), 0);
		expect(sum((bucket) => bucket.hands)).toBe(result.hands);
		expect(sum((bucket) => bucket.roundsPlayed)).toBe(result.roundsPlayed);
		expect(sum((bucket) => bucket.wagered)).toBeCloseTo(result.wagered, 6);
		expect(sum((bucket) => bucket.av)).toBeCloseTo(result.stats.av, 6);
		expect(sum((bucket) => bucket.ev)).toBeCloseTo(result.ev, 6);
	});

	it('reports an average bet the total wagered comes back from', () => {
		expect(result.averageBet * result.roundsPlayed).toBeCloseTo(result.wagered, 6);
		// Between the bottom and the top of the ramp, since both ends get played.
		expect(result.averageBet).toBeGreaterThan(25);
		expect(result.averageBet).toBeLessThan(12 * 25);
	});

	it('samples the walk from end to end', () => {
		expect(result.samples.length).toBeGreaterThan(1);
		expect(result.samples[0].rounds).toBeLessThan(result.roundsSeen);
		// Checkpointed against rounds dealt, so the last one is the run's own end.
		expect(result.samples[result.samples.length - 1].rounds).toBe(result.roundsSeen);
		// The last checkpoint is the run's own totals, not a round or two short.
		expect(result.samples[result.samples.length - 1].av).toBeCloseTo(result.stats.av, 6);
		expect(result.samples[result.samples.length - 1].ev).toBeCloseTo(result.ev, 6);
	});
});

describe('determinism', () => {
	it('deals the same session twice from one seed', () => {
		const a = play(inputs({ rounds: 3_000, seed: 12345 }));
		const b = play(inputs({ rounds: 3_000, seed: 12345 }));
		expect(b).toEqual(a);
	});

	it('deals a different one from another seed', () => {
		const a = play(inputs({ rounds: 3_000, seed: 1 }));
		const b = play(inputs({ rounds: 3_000, seed: 2 }));
		expect(b.stats.av).not.toBe(a.stats.av);
	});

	it('is unmoved by the chunk size the caller steps it in', () => {
		// The worker chooses chunks for responsiveness alone, so they must not be
		// able to change a figure.
		const one = play(inputs({ rounds: 1_500, seed: 99 }), 1_500);
		const many = play(inputs({ rounds: 1_500, seed: 99 }), 37);
		expect(many).toEqual(one);
	});
});

describe('back-counting', () => {
	const result = play(inputs({ rounds: 2_000, seed: 3, wongInCount: 2 }));

	it('spends the budget on rounds dealt, not rounds wagered on', () => {
		// The session is what was sized: a back-counter who plays one round in
		// five has still stood at the table for all five, and the run stops when
		// the table has dealt what it was asked to.
		expect(result.roundsSeen).toBe(2_000);
		expect(result.roundsPlayed).toBeLessThan(result.roundsSeen);
	});

	it('reports what it spent watching', () => {
		expect(result.roundsWatched).toBe(result.roundsSeen - result.roundsPlayed);
		expect(result.watchedPercent).toBeCloseTo(
			(result.roundsWatched / result.roundsSeen) * 100,
			6
		);
		// Wonging in at +2 sits out most of a shoe, which is the whole cost of the
		// strategy and the reason the figure is on the band.
		expect(result.watchedPercent).toBeGreaterThan(50);
		expect(result.hoursWatched).toBeCloseTo(result.roundsWatched / 80, 6);
		expect(result.hoursWatched).toBeLessThan(result.hours);
	});

	it('leaves the excluded buckets seen but unwagered', () => {
		const excluded = result.buckets.filter((bucket) => bucket.trueCount < 2);
		expect(excluded.some((bucket) => bucket.rounds > 0)).toBe(true);
		for (const bucket of excluded) {
			expect(bucket.roundsPlayed).toBe(0);
			expect(bucket.wagered).toBe(0);
			expect(bucket.hands).toBe(0);
			expect(bucket.av).toBe(0);
		}
	});

	it('wagers in the buckets it sat down for', () => {
		const played = result.buckets.filter((bucket) => bucket.trueCount >= 2);
		expect(played.some((bucket) => bucket.roundsPlayed > 0)).toBe(true);
	});

	it('sits out below a wong-out count when it never sat down for one', () => {
		// Wong-in never bites, so the seat is held from the first round and given up
		// only where the count falls under the exit: the two settings collapse to
		// the round-by-round reading, and no bucket below it is wagered in.
		const out = play(inputs({ rounds: 2_000, seed: 3, wongOutCount: 0 }));
		for (const bucket of out.buckets.filter((bucket) => bucket.trueCount < 0)) {
			expect(bucket.roundsPlayed).toBe(0);
		}
		expect(out.roundsPlayed).toBeGreaterThan(0);
	});

	it('holds the seat below the count it was taken at', () => {
		// The whole point of the pair being read with hysteresis: a counter who sits
		// down at +2 and leaves under -1 plays the cooling shoe in between, which is
		// strictly more rounds than one who gets up the moment it drops under +2.
		const config = { rounds: 2_000, seed: 3, wongInCount: 2 };
		const tight = play(inputs(config));
		const held = play(inputs({ ...config, wongOutCount: -1 }));
		expect(held.roundsPlayed).toBeGreaterThan(tight.roundsPlayed);
		// And they are rounds the tight setting never wagered on: counts under the
		// entry, which only a seat already taken can reach.
		const low = (result: SimResult) =>
			result.buckets
				.filter((bucket) => bucket.trueCount < 2)
				.reduce((sum, bucket) => sum + bucket.roundsPlayed, 0);
		expect(low(tight)).toBe(0);
		expect(low(held)).toBeGreaterThan(0);
	});

	it('lets an exit above the entry win rather than seating every other round', () => {
		// Sitting down at 0 and getting up under +3 is not refused, but nor is it
		// taken literally: a seat given up the round after it is taken is not a
		// strategy, so the exit does both jobs and the run plays +3 and up.
		const config = { rounds: 2_000, seed: 3, wongInCount: 0 };
		const plain = play(inputs(config));
		const odd = play(inputs({ ...config, wongOutCount: 3 }));
		expect(odd.roundsPlayed).toBeGreaterThan(0);
		expect(odd.roundsPlayed).toBeLessThan(plain.roundsPlayed);
		expect(odd.roundsPlayed).toBe(
			play(inputs({ ...config, wongInCount: 3 })).roundsPlayed
		);
		for (const bucket of odd.buckets.filter((bucket) => bucket.trueCount < 3)) {
			expect(bucket.roundsPlayed).toBe(0);
		}
	});
});

describe('the other spots', () => {
	it('burn the shoe faster, so fewer rounds fit before the cut', () => {
		const headsUp = play(inputs({ rounds: 3_000, seed: 5, otherSpots: 0 }));
		const crowded = play(inputs({ rounds: 3_000, seed: 5, otherSpots: 5 }));
		expect(crowded.shoes).toBeGreaterThan(headsUp.shoes);
	});
});

describe('cut-card variance', () => {
	it('deals a different session without changing the game', () => {
		const fixed = play(inputs({ rounds: 3_000, seed: 8, cutCardVarianceDecks: 0 }));
		const jittered = play(inputs({ rounds: 3_000, seed: 8, cutCardVarianceDecks: 1 }));
		// The cut card moves from the second shuffle on, so the two run the same
		// first shoe and different ones after it.
		expect(jittered.stats.av).not.toBe(fixed.stats.av);
		// Both are still the same game dealt to the same depth on average, so
		// neither should have wandered far from the other's shoe count. (Where the
		// jitter itself lands is `tests/utils/play/shoe.test.ts`'s question.)
		expect(Math.abs(jittered.shoes - fixed.shoes)).toBeLessThan(fixed.shoes * 0.3);
	});
});

describe('against the closed-form bankroll model', () => {
	/**
	 * The two answer the same question by different means, so under a tag vector
	 * that carries no information -- every round played and priced at a count of
	 * zero -- the sim's expectation is the engine's own whole-shoe average, and
	 * `analyzeBankroll`'s flat-bet edge is that same average plus the curve's bend
	 * over a count distribution that is not there.
	 *
	 * The tolerance is sampling error, not slack: one round's EV has a spread of
	 * about 0.4 units, so a hundred thousand of them leave a standard error
	 * around a tenth of a percentage point. A run that has gone wrong misses by
	 * points, not by tenths -- the natural-pricing bug this test was written
	 * against was out by seven.
	 */
	const ruleSet: RuleSet = DEFAULT_RULE_SET;
	const wholeShoeEv = averageEvPercent(
		new ShoeEv(ruleSet).analyzeAverage(baseComposition(ruleSet)),
		ruleSet.blackjackPayout
	);

	it(
		'reproduces the whole-shoe average under a flat bet at a blind count',
		{ timeout: TIMEOUT_MS },
		() => {
			const result = play(
				inputs(
					{ rounds: 100_000, seed: 4, deviations: 'basic' },
					{ tags: ZERO_TAGS, ramp: FLAT_RAMP, unit: 1 }
				)
			);
			expect(result.evEdgePercent).toBeCloseTo(wholeShoeEv, 0);
			expect(Math.abs(result.evEdgePercent - wholeShoeEv)).toBeLessThan(0.25);
		}
	);

	it(
		'lands beside analyzeBankroll on the same flat game',
		{ timeout: TIMEOUT_MS },
		() => {
			const predicted = analyzeBankroll(ruleSet, ZERO_TAGS, {
				bankroll: 10_000,
				unit: 1,
				roundsPerHour: 80,
				ramp: FLAT_RAMP,
				baseEvPercent: wholeShoeEv,
				// A blind count has no edge curve to fit: every count it can read is
				// zero, so the bankroll model is the base edge alone.
				edgeSlopePointsPerTrueCount: 0,
				edgeCurvaturePointsPerTrueCountSquared: 0,
				variancePerRound: 1.3,
			});
			const result = play(
				inputs(
					{ rounds: 100_000, seed: 4, deviations: 'basic' },
					{ tags: ZERO_TAGS, ramp: FLAT_RAMP, unit: 1 }
				)
			);
			expect(Math.abs(result.evEdgePercent - predicted.edgePercent)).toBeLessThan(0.25);
			expect(result.averageBet).toBeCloseTo(predicted.averageBetCurrency, 6);
		}
	);

	it('turns a spread into a better edge than a flat bet', { timeout: TIMEOUT_MS }, () => {
		// The whole point of a ramp, and the one comparison a sim can make that
		// needs no closed form at all: the same shoes, the same play, more money
		// on the counts that are worth more.
		const flat = play(
			inputs({ rounds: 60_000, seed: 6, deviations: 'i18' }, { ramp: FLAT_RAMP })
		);
		const spread = play(
			inputs({ rounds: 60_000, seed: 6, deviations: 'i18' }, { ramp: SPREAD_RAMP })
		);
		expect(spread.evEdgePercent).toBeGreaterThan(flat.evEdgePercent + 0.5);
		expect(spread.averageBet).toBeGreaterThan(flat.averageBet);
	});
});

describe('the deviation modes', () => {
	it('plays every decision optimally in full mode, and not in basic', () => {
		// Full mode plays off exactly the prices the coach grades against, so it
		// cannot be marked down -- which is also the check that the policy and the
		// coach are reading one cell rather than two.
		const full = play(inputs({ rounds: 2_000, seed: 11, deviations: 'full' }));
		expect(full.optimalPlayPercent).toBe(100);
		expect(full.stats.evLost).toBeCloseTo(0, 8);

		const basic = play(inputs({ rounds: 2_000, seed: 11, deviations: 'basic' }));
		expect(basic.optimalPlayPercent).toBeLessThan(100);
		expect(basic.stats.evLost).toBeGreaterThan(0);
	});

	it('gives up less to the count under the eighteen than under basic strategy', () => {
		const basic = play(inputs({ rounds: 20_000, seed: 13, deviations: 'basic' }));
		const i18 = play(inputs({ rounds: 20_000, seed: 13, deviations: 'i18' }));
		expect(i18.stats.evLost).toBeLessThan(basic.stats.evLost);
		expect(i18.optimalPlayPercent!).toBeGreaterThan(basic.optimalPlayPercent!);
		// Neither departs so far from the other that they stop being the same
		// strategy: the eighteen are eighteen cells out of several hundred.
		expect(i18.optimalPlayPercent!).toBeLessThan(basic.optimalPlayPercent! + 5);
	});

	it('takes no insurance on basic strategy and some under the indices', () => {
		const basic = play(inputs({ rounds: 20_000, seed: 14, deviations: 'basic' }));
		const i18 = play(inputs({ rounds: 20_000, seed: 14, deviations: 'i18' }));
		expect(basic.roundsPlayed).toBe(i18.roundsPlayed);
		// Not directly reported, so it is read off the one thing it moves: the two
		// runs deal identical cards, so any difference in AV is the side bet and
		// the eighteen between them.
		expect(i18.stats.av).not.toBe(basic.stats.av);
	});
});

describe('settings that wager on nothing at all', () => {
	/**
	 * None of these is an error. The budget counts rounds *dealt*, so a session
	 * that never wagers is a finite run with an answer -- and "how much of my time
	 * would this leave me standing there" is a reasonable thing to ask.
	 */
	it('watches out an entry count the shoe never reaches', () => {
		const result = play(inputs({ rounds: 500, wongInCount: 9 }));
		expect(result.roundsSeen).toBe(500);
		expect(result.roundsPlayed).toBe(0);
		expect(result.roundsWatched).toBe(500);
		expect(result.watchedPercent).toBe(100);
		expect(result.wagered).toBe(0);
	});

	it('watches out a ramp that stakes nothing anywhere', () => {
		const result = play(inputs({ rounds: 500 }, { ramp: [0, 0, 0, 0, 0, 0, 0] }));
		expect(result.roundsSeen).toBe(500);
		expect(result.roundsPlayed).toBe(0);
		expect(result.watchedPercent).toBe(100);
	});

	it('reports zeroes for a run that staked nothing rather than dividing by them', () => {
		const result = play(inputs({ rounds: 500, wongInCount: 9 }));
		expect(result.edgePercent).toBe(0);
		expect(result.evEdgePercent).toBe(0);
		expect(result.averageBet).toBe(0);
		expect(result.n0Rounds).toBe(Infinity);
		expect(result.evDeviationSigmas).toBeNull();
		expect(result.optimalPlayPercent).toBeNull();
		// The shoes still went past the cut card, and the rounds still happened.
		expect(result.shoes).toBeGreaterThan(1);
		expect(result.buckets.reduce((sum, bucket) => sum + bucket.rounds, 0)).toBe(500);
	});

	it('plays only where a one-count ramp has money, slow though that is', () => {
		const only = [0, 0, 0, 0, 0, 0, 12];
		const result = play(inputs({ rounds: 3_000, seed: 2 }, { ramp: only }));
		expect(result.roundsSeen).toBe(3_000);
		expect(result.roundsPlayed).toBeGreaterThan(0);
		expect(result.roundsPlayed).toBeLessThan(result.roundsSeen);
		// Every round it played was one the ramp had money on.
		for (const bucket of result.buckets.filter((entry) => entry.trueCount < 6)) {
			expect(bucket.roundsPlayed).toBe(0);
		}
	});
});

describe('a run with nothing in it', () => {
	it('reports zeroes rather than dividing by them', () => {
		const empty = summarizeRun(createRun(inputs({ rounds: 0 })));
		expect(empty.roundsSeen).toBe(0);
		expect(empty.roundsPlayed).toBe(0);
		expect(empty.watchedPercent).toBe(0);
		expect(empty.edgePercent).toBe(0);
		expect(empty.evEdgePercent).toBe(0);
		expect(empty.averageBet).toBe(0);
		expect(empty.winRatePerHour).toBe(0);
		expect(empty.n0Rounds).toBe(Infinity);
		expect(empty.evDeviationSigmas).toBeNull();
		expect(empty.optimalPlayPercent).toBeNull();
	});
});
