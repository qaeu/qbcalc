import { describe, it, expect } from 'vitest';

import {
	analyzeBankroll,
	hiLoCountScale,
	trueCountFrequencies,
	RAMP_TRUE_COUNTS,
	type BankrollInputs,
} from '#utils/bankroll';
import { RANKS } from '#utils/ev/cards';
import { ACE_FIVE_TAGS, baseComposition, type TagValues } from '#utils/ev/composition';
import { DEFAULT_RULE_SET, type RuleSet } from '#utils/ev/rules';
import { tagsForSystem } from '#utils/countingSystems';

const SIX_DECK: RuleSet = { ...DEFAULT_RULE_SET, decks: 6, penetrationPercent: 75 };

const HI_LO: TagValues = tagsForSystem('hi-lo')!;
const RPC: TagValues = tagsForSystem('rpc')!;

/** The same counting system written on a bigger axis: every tag multiplied. */
function scaleTags(tags: TagValues, factor: number): TagValues {
	const scaled = {} as TagValues;
	for (const rank of RANKS) scaled[rank] = tags[rank] * factor;
	return scaled;
}

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
	edgeCurvaturePointsPerTrueCountSquared: 0.005,
	variancePerRound: 1.22,
};

/** The same inputs with the edge curve straightened back out. */
const STRAIGHT: Partial<BankrollInputs> = {
	edgeCurvaturePointsPerTrueCountSquared: 0,
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

describe('hiLoCountScale', () => {
	const comp = baseComposition(SIX_DECK);

	it('is one for Hi-Lo itself', () => {
		expect(hiLoCountScale(comp, HI_LO)).toBeCloseTo(1, 12);
	});

	it('follows the tag axis, so a doubled system counts twice as fast', () => {
		expect(hiLoCountScale(comp, scaleTags(HI_LO, 2))).toBeCloseTo(2, 12);
		// A level-two count runs on roughly twice Hi-Lo's axis: its +6 is about a
		// Hi-Lo +3, which is the whole reason the ramp is denominated in Hi-Lo.
		expect(hiLoCountScale(comp, RPC)).toBeGreaterThan(1.8);
		expect(hiLoCountScale(comp, RPC)).toBeLessThan(2.1);
	});

	it('is zero for tags that tell no rank from another', () => {
		const flat = scaleTags(HI_LO, 0);
		expect(hiLoCountScale(comp, flat)).toBe(0);
		// And the count that carries no information puts everything at zero rather
		// than dividing by its own missing spread.
		const [atOrBelowZero] = trueCountFrequencies(SIX_DECK, flat);
		expect(atOrBelowZero.frequency).toBeCloseTo(1, 10);
	});
});

describe('trueCountFrequencies', () => {
	it('is a probability distribution over the ramp buckets', () => {
		const buckets = trueCountFrequencies(SIX_DECK, HI_LO);
		expect(buckets).toHaveLength(RAMP_TRUE_COUNTS.length);
		expect(totalFrequency(SIX_DECK, HI_LO)).toBeCloseTo(1, 10);
		for (const bucket of buckets) {
			expect(bucket.frequency).toBeGreaterThanOrEqual(0);
		}
	});

	it('carries a mean square that outruns the square of the mean', () => {
		// Jensen, and the whole reason the curvature is priced off a second moment
		// rather than off `meanTrueCount²`: the gap is the spread of counts inside
		// the bucket, and it is widest in the two open-ended ends.
		const buckets = trueCountFrequencies(SIX_DECK, HI_LO);
		for (const bucket of buckets) {
			expect(bucket.meanSquaredTrueCount).toBeGreaterThanOrEqual(
				bucket.meanTrueCount * bucket.meanTrueCount
			);
		}
		const spreadIn = (bucket: (typeof buckets)[number]) =>
			bucket.meanSquaredTrueCount - bucket.meanTrueCount * bucket.meanTrueCount;
		expect(spreadIn(buckets[buckets.length - 1])).toBeGreaterThan(spreadIn(buckets[3]));
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

	it('is the same distribution for every system, the axis being Hi-Lo-equivalent', () => {
		// The buckets are Hi-Lo counts whatever the tags, so how often the ramp's
		// top bucket comes up is a fact about the shoe and the penetration -- not
		// about how big the numbers a system happens to write on its cards are.
		for (const tags of [RPC, ACE_FIVE_TAGS, scaleTags(HI_LO, 7)]) {
			trueCountFrequencies(SIX_DECK, tags).forEach((bucket, index) => {
				const reference = trueCountFrequencies(SIX_DECK, HI_LO)[index];
				expect(bucket.frequency).toBeCloseTo(reference.frequency, 10);
				expect(bucket.meanTrueCount).toBeCloseTo(reference.meanTrueCount, 10);
			});
		}
	});

	it('still totals one under a count that barely moves', () => {
		// Ace-Five tags all but two ranks at zero, so its own count is a fraction
		// of Hi-Lo's -- the conversion to the Hi-Lo axis has the smallest spread of
		// any preset to divide back up.
		expect(totalFrequency(SIX_DECK, ACE_FIVE_TAGS)).toBeCloseTo(1, 10);
	});
});

describe('analyzeBankroll', () => {
	it('reproduces the flat-bet edge on a straight line when the ramp does not spread', () => {
		const flat = analyse(STRAIGHT);
		expect(flat.averageBetUnits).toBeCloseTo(1, 10);
		// Exactly the count-zero edge, not merely near it: the count is mean-zero
		// and this edge is linear in it, so a bet that ignores the count collects
		// the edge at the mean. This is what pins the bucket means down -- pricing
		// a bucket at its label instead leaves this visibly too high.
		expect(flat.evUnitsPerRound).toBeCloseTo(BASE_INPUTS.baseEvPercent / 100, 10);
		expect(flat.varianceUnitsPerRound).toBeCloseTo(BASE_INPUTS.variancePerRound, 2);
		// And the headline edge is that same figure per unit wagered, which at a
		// flat bet is the round's EV unchanged.
		expect(flat.edgePercent).toBeCloseTo(BASE_INPUTS.baseEvPercent, 10);
	});

	it('pays a flat bet the curvature over the whole count distribution', () => {
		// A curved edge breaks the identity above, and correctly so: the counts a
		// shoe passes through are worth more on average than the count at their
		// average, because a shoe is played better the further the count is from
		// zero either way. What a flat bet collects is the curvature against the
		// distribution's own second moment, which is what the bucket squares carry.
		const curved = analyse();
		const straight = analyse(STRAIGHT);
		const secondMoment = trueCountFrequencies(SIX_DECK, HI_LO).reduce(
			(sum, bucket) => sum + bucket.frequency * bucket.meanSquaredTrueCount,
			0
		);

		expect(secondMoment).toBeGreaterThan(0);
		expect(curved.edgePercent).toBeCloseTo(
			straight.edgePercent
				+ BASE_INPUTS.edgeCurvaturePointsPerTrueCountSquared * secondMoment,
			10
		);
		// Small, but the right side of zero: flat-betting a counted game is worth a
		// shade more than the house edge, because the hands are still played off it.
		expect(curved.edgePercent).toBeGreaterThan(straight.edgePercent);
		expect(curved.edgePercent - straight.edgePercent).toBeLessThan(0.05);
	});

	it('pays the curvature most where the ramp bets most', () => {
		// The end buckets hold the counts furthest from zero, so they carry by far
		// the largest squares -- which is exactly where a spread has its money, and
		// why leaving the term out understates a steep ramp more than a flat one.
		const ramp = [1, 1, 2, 4, 8, 12, 12];
		const flatGain = analyse().edgePercent - analyse(STRAIGHT).edgePercent;
		const rampGain =
			analyse({ ramp }).edgePercent - analyse({ ...STRAIGHT, ramp }).edgePercent;

		expect(rampGain).toBeGreaterThan(flatGain);
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

	it('reads the same game off a counting system written on a bigger axis', () => {
		const ramp = [1, 1, 2, 4, 8, 12, 12];
		// Doubling every tag doubles every count and adds no information: the same
		// shoe is worth the same edge per count, so the slope halves. Before the
		// ramp was denominated in Hi-Lo counts this rescaling alone moved the win
		// rate by half again, which is what let a level-two count be ranked against
		// a level-one one on nothing but the size of its tags.
		const hiLo = analyse({ ramp });
		const doubled = analyse(
			{
				ramp,
				edgeSlopePointsPerTrueCount: BASE_INPUTS.edgeSlopePointsPerTrueCount / 2,
				// And the curvature, being per squared count, falls by the square.
				edgeCurvaturePointsPerTrueCountSquared:
					BASE_INPUTS.edgeCurvaturePointsPerTrueCountSquared / 4,
			},
			SIX_DECK,
			scaleTags(HI_LO, 2)
		);

		expect(doubled.edgePercent).toBeCloseTo(hiLo.edgePercent, 10);
		expect(doubled.winRatePerHour).toBeCloseTo(hiLo.winRatePerHour, 10);
		expect(doubled.averageBetUnits).toBeCloseTo(hiLo.averageBetUnits, 10);
		expect(doubled.riskOfRuin).toBeCloseTo(hiLo.riskOfRuin, 10);
	});

	it('separates two systems by the information their tags carry, not their scale', () => {
		const ramp = [1, 1, 2, 4, 8, 12, 12];
		// What is left once the axis is normalised is `slope · scale`. Hi-Lo at its
		// own slope against a doubled axis carrying a slope that has not halved to
		// match is a strictly better system, and only then does it read better.
		const comp = baseComposition(SIX_DECK);
		const better = analyse(
			{
				ramp,
				edgeSlopePointsPerTrueCount: BASE_INPUTS.edgeSlopePointsPerTrueCount / 1.5,
			},
			SIX_DECK,
			scaleTags(HI_LO, 2)
		);
		expect(hiLoCountScale(comp, scaleTags(HI_LO, 2))).toBeCloseTo(2, 12);
		expect(better.edgePercent).toBeGreaterThan(analyse({ ramp }).edgePercent);
		expect(better.winRatePerHour).toBeGreaterThan(analyse({ ramp }).winRatePerHour);
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
