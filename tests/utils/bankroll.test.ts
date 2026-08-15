import { describe, it, expect } from 'vitest';

import {
	analyzeBankroll,
	trueCountFrequencies,
	RAMP_TRUE_COUNTS,
	type BankrollInputs,
} from '#utils/bankroll';
import { ACE_FIVE_TAGS, type TagValues } from '#utils/ev/composition';
import { DEFAULT_RULE_SET, type RuleSet } from '#utils/ev/rules';
import { tagsForSystem } from '#utils/countingSystems';

const SIX_DECK: RuleSet = { ...DEFAULT_RULE_SET, decks: 6, penetrationPercent: 75 };

const HI_LO: TagValues = tagsForSystem('hi-lo')!;

/** A flat one-unit bet in every bucket: the ramp that spreads nothing. */
const FLAT_RAMP = RAMP_TRUE_COUNTS.map(() => 1);

/**
 * Figures close enough to a real six-deck game to keep the tests honest, but
 * pinned rather than computed so the engine and this module can fail separately.
 */
const BASE_INPUTS: Omit<BankrollInputs, 'ramp'> = {
	bankroll: 10000,
	unit: 25,
	roundsPerHour: 100,
	baseEvPercent: -0.42,
	edgeSlopePointsPerTrueCount: 0.71,
	variancePerRound: 1.22,
};

function analyse(
	inputs: Partial<BankrollInputs> = {},
	ruleSet: RuleSet = SIX_DECK,
	tags: TagValues = HI_LO
) {
	return analyzeBankroll(ruleSet, tags, {
		...BASE_INPUTS,
		ramp: FLAT_RAMP,
		...inputs,
	});
}

function totalFrequency(ruleSet: RuleSet, tags: TagValues): number {
	return trueCountFrequencies(ruleSet, tags).reduce(
		(sum, bucket) => sum + bucket.frequency,
		0
	);
}

describe('trueCountFrequencies', () => {
	it('is a probability distribution over the ramp buckets', () => {
		const buckets = trueCountFrequencies(SIX_DECK, HI_LO);
		expect(buckets).toHaveLength(RAMP_TRUE_COUNTS.length);
		expect(totalFrequency(SIX_DECK, HI_LO)).toBeCloseTo(1, 10);
		for (const bucket of buckets) {
			expect(bucket.frequency).toBeGreaterThanOrEqual(0);
		}
	});

	it('puts about half the mass at or below zero for a balanced system', () => {
		// The count is symmetric about zero, and the first bucket is the whole of
		// the negative half plus the sliver up to +0.5.
		const [atOrBelowZero] = trueCountFrequencies(SIX_DECK, HI_LO);
		expect(atOrBelowZero.frequency).toBeGreaterThan(0.5);
		expect(atOrBelowZero.frequency).toBeLessThan(0.75);
	});

	it('reaches high counts more often the deeper the shoe is dealt', () => {
		const high = (penetrationPercent: number) =>
			trueCountFrequencies({ ...SIX_DECK, penetrationPercent }, HI_LO)
				.filter((bucket) => bucket.trueCount >= 3)
				.reduce((sum, bucket) => sum + bucket.frequency, 0);

		expect(high(50)).toBeLessThan(high(75));
		expect(high(75)).toBeLessThan(high(90));
	});

	it('reaches high counts more often on a smaller shoe', () => {
		const high = (decks: number) =>
			trueCountFrequencies({ ...SIX_DECK, decks }, HI_LO)
				.filter((bucket) => bucket.trueCount >= 3)
				.reduce((sum, bucket) => sum + bucket.frequency, 0);

		expect(high(6)).toBeLessThan(high(2));
	});

	it('still totals one under a count that barely moves', () => {
		// Ace-Five tags almost every rank at zero, so the distribution is narrow
		// enough that nearly everything lands in the first bucket.
		expect(totalFrequency(SIX_DECK, ACE_FIVE_TAGS)).toBeCloseTo(1, 10);
	});
});

describe('analyzeBankroll', () => {
	it('reproduces the flat-bet edge when the ramp does not spread', () => {
		const flat = analyse();
		expect(flat.averageBetUnits).toBeCloseTo(1, 10);
		// Exactly the count-zero edge, not merely near it: the count is mean-zero
		// and the edge is linear in it, so a bet that ignores the count collects
		// the edge at the mean. This is what pins the bucket means down -- pricing
		// a bucket at its label instead leaves this visibly too high.
		expect(flat.evUnitsPerRound).toBeCloseTo(BASE_INPUTS.baseEvPercent / 100, 10);
		expect(flat.varianceUnitsPerRound).toBeCloseTo(BASE_INPUTS.variancePerRound, 2);
		// And the headline edge is that same figure per unit wagered, which at a
		// flat bet is the round's EV unchanged.
		expect(flat.edgePercent).toBeCloseTo(BASE_INPUTS.baseEvPercent, 10);
	});

	it('reports the edge per unit wagered, weighted by frequency and bet', () => {
		const ramp = [1, 1, 2, 4, 8, 12, 12];
		const result = analyse({ ramp });

		// The spread is what turns the house edge into the player's: the same
		// per-count edges, weighted towards the counts worth betting into.
		expect(result.edgePercent).toBeGreaterThan(0);
		expect(result.edgePercent).toBeGreaterThan(analyse().edgePercent);
		// Per unit wagered, so it is the round's EV divided by the round's bet --
		// a smaller number than the EV per round, which rides ~1.8 units.
		expect(result.edgePercent).toBeCloseTo(
			(result.evUnitsPerRound / result.averageBetUnits) * 100,
			10
		);
		expect(result.edgePercent).toBeLessThan(result.evUnitsPerRound * 100);
	});

	it('reads the edge off the spread and penetration, not the bankroll', () => {
		const ramp = [1, 1, 2, 4, 8, 12, 12];
		// Money changes what the edge is worth, never what it is.
		expect(analyse({ ramp, bankroll: 50000, unit: 100 }).edgePercent).toBeCloseTo(
			analyse({ ramp }).edgePercent,
			10
		);
		// Penetration does change it: a deeper shoe reaches the counts the ramp
		// is betting into more often.
		expect(
			analyse({ ramp }, { ...SIX_DECK, penetrationPercent: 90 }).edgePercent
		).toBeGreaterThan(
			analyse({ ramp }, { ...SIX_DECK, penetrationPercent: 50 }).edgePercent
		);
	});

	it('reports no edge when the ramp bets nothing', () => {
		expect(analyse({ ramp: RAMP_TRUE_COUNTS.map(() => 0) }).edgePercent).toBe(0);
	});

	it('turns a losing game into a winning one once the spread is steep enough', () => {
		expect(analyse().evUnitsPerRound).toBeLessThan(0);
		expect(analyse({ ramp: [1, 1, 2, 4, 8, 12, 12] }).evUnitsPerRound).toBeGreaterThan(0);
	});

	it('bets more and wins more as the spread steepens', () => {
		const narrow = analyse({ ramp: [1, 1, 2, 2, 4, 4, 4] });
		const wide = analyse({ ramp: [1, 1, 2, 4, 8, 12, 12] });

		expect(wide.averageBetUnits).toBeGreaterThan(narrow.averageBetUnits);
		expect(wide.winRatePerHour).toBeGreaterThan(narrow.winRatePerHour);
		expect(wide.varianceUnitsPerRound).toBeGreaterThan(narrow.varianceUnitsPerRound);
	});

	it('raises risk of ruin as the unit grows against a fixed bankroll', () => {
		const ramp = [1, 1, 2, 4, 8, 12, 12];
		expect(analyse({ ramp, unit: 50 }).riskOfRuin).toBeGreaterThan(
			analyse({ ramp, unit: 25 }).riskOfRuin
		);
	});

	it('calls a game with no edge certain ruin, however deep the bankroll', () => {
		const flat = analyse({ bankroll: 1e9 });
		expect(flat.evUnitsPerRound).toBeLessThan(0);
		expect(flat.riskOfRuin).toBe(1);
		expect(flat.n0Rounds).toBe(Infinity);
	});

	it('lowers risk of ruin as the bankroll grows', () => {
		const ramp = [1, 1, 2, 4, 8, 12, 12];
		const small = analyse({ ramp, bankroll: 5000 });
		const large = analyse({ ramp, bankroll: 20000 });

		expect(large.riskOfRuin).toBeLessThan(small.riskOfRuin);
		// Doubling the bankroll squares the risk, per the exponential.
		const mid = analyse({ ramp, bankroll: 10000 });
		expect(large.riskOfRuin).toBeCloseTo(mid.riskOfRuin * mid.riskOfRuin, 6);
	});

	it('puts risk of ruin at the textbook 1/e² when betting full Kelly', () => {
		const ramp = [1, 1, 2, 4, 8, 12, 12];
		const start = analyse({ ramp });
		// Re-analysed at its own Kelly unit, the ramp is betting full Kelly, where
		// the standard exponential gives e^-2 -- about 13.5%.
		const kelly = analyse({ ramp, unit: start.kellyUnit });
		expect(kelly.riskOfRuin).toBeCloseTo(Math.exp(-2), 6);
	});

	it('derives N0, the hourly figures and the Kelly unit from ev and variance', () => {
		const ramp = [1, 1, 2, 4, 8, 12, 12];
		const result = analyse({ ramp });
		const { evUnitsPerRound: ev, varianceUnitsPerRound: variance } = result;

		expect(result.n0Rounds).toBeCloseTo(variance / (ev * ev), 6);
		expect(result.kellyUnit).toBeCloseTo((10000 * ev) / variance, 6);
		expect(result.winRatePerHour).toBeCloseTo(ev * 100 * 25, 6);
		expect(result.sdPerHour).toBeCloseTo(Math.sqrt(100 * variance) * 25, 6);
	});

	it('treats a zero unit as no bankroll rather than dividing by it', () => {
		const result = analyse({ ramp: [1, 1, 2, 4, 8, 12, 12], unit: 0 });
		expect(Number.isFinite(result.riskOfRuin)).toBe(true);
		expect(result.riskOfRuin).toBe(1);
	});
});
