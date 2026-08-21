import { describe, it, expect } from 'vitest';

import {
	ROUND_TRUE_COUNTS,
	simulateRoundFrequency,
	type RoundFrequency,
} from '#utils/countRounds';
import { ACE_FIVE_TAGS, type TagValues } from '#utils/ev/composition';
import { DEFAULT_RULE_SET, type RuleSet } from '#utils/ev/rules';
import { tagsForSystem } from '#utils/countingSystems';

const SIX_DECK: RuleSet = { ...DEFAULT_RULE_SET, decks: 6, penetrationPercent: 75 };
const SINGLE_DECK: RuleSet = { ...DEFAULT_RULE_SET, decks: 1, penetrationPercent: 75 };

const HI_LO: TagValues = tagsForSystem('hi-lo')!;

/** Abramowitz & Stegun 7.1.26, which is plenty for a tolerance check. */
function erf(x: number): number {
	const t = 1 / (1 + 0.3275911 * Math.abs(x));
	const series =
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t
			+ 0.254829592)
		* t;
	const magnitude = 1 - series * Math.exp(-x * x);
	return x >= 0 ? magnitude : -magnitude;
}

/** Share of rounds played at `trueCount` or better. */
function atOrAbove(shoe: RoundFrequency, trueCount: number): number {
	return shoe.rounds
		.filter((bucket) => bucket.trueCount >= trueCount)
		.reduce((sum, bucket) => sum + bucket.frequency, 0);
}

describe('simulateRoundFrequency', () => {
	it('files every round exactly once', () => {
		const shoe = simulateRoundFrequency(SIX_DECK, HI_LO);
		expect(shoe.rounds).toHaveLength(ROUND_TRUE_COUNTS.length);

		const total = shoe.rounds.reduce((sum, bucket) => sum + bucket.frequency, 0);
		expect(total).toBeCloseTo(1, 10);
		expect(shoe.advantageShare).toBeCloseTo(atOrAbove(shoe, 1), 10);
	});

	it('deals the rounds the penetration leaves room for', () => {
		// Six decks is 312 cards, three quarters of which is 234, at five cards a
		// round. The count of rounds is exact, not sampled, so this is an identity.
		const shoe = simulateRoundFrequency(SIX_DECK, HI_LO);
		expect(shoe.roundsPerShoe).toBeCloseTo(Math.ceil(234 / 5), 10);
	});

	it('spends most of its rounds near zero, falling away either side', () => {
		const shoe = simulateRoundFrequency(SIX_DECK, HI_LO);
		const at = (trueCount: number) =>
			shoe.rounds.find((bucket) => bucket.trueCount === trueCount)!.frequency;

		expect(at(0)).toBeGreaterThan(at(1));
		expect(at(1)).toBeGreaterThan(at(2));
		expect(at(2)).toBeGreaterThan(at(3));
		expect(at(0)).toBeGreaterThan(at(-1));
		expect(at(-1)).toBeGreaterThan(at(-2));
	});

	it('matches a closed form for the share of rounds at zero', () => {
		// An independent check on the whole simulation. The running count after n
		// cards of a shoe of N has variance `n(N-n)/(N-1) · σ²` for a tag variance
		// σ², so the true count at each read is near-normal with a known spread,
		// and the zero bucket is `P(|TC| < 0.5)` averaged over the reads. The two
		// disagree slightly because the real count is integral where the normal is
		// continuous, which is exactly what a closed form cannot capture.
		const cards = 6 * 52;
		const tagVariance = 40 / 52; // Hi-Lo tags forty of every fifty-two cards ±1.
		const cut = Math.floor(cards * 0.75);
		const normalCdf = (z: number) => (1 + erf(z / Math.SQRT2)) / 2;

		let reads = 0;
		let atZero = 0;
		for (let seen = 0; seen < cut; seen += 5) {
			const left = cards - seen;
			reads += 1;
			const sdCount = Math.sqrt(((seen * left) / (cards - 1)) * tagVariance);
			const sdTrue = seen === 0 ? 0 : (sdCount * 52) / left;
			atZero += sdTrue === 0 ? 1 : 2 * normalCdf(0.5 / sdTrue) - 1;
		}

		const shoe = simulateRoundFrequency(SIX_DECK, HI_LO);
		const zero = shoe.rounds.find((bucket) => bucket.trueCount === 0)!.frequency;
		expect(zero).toBeCloseTo(atZero / reads, 1);
	});

	it('prices its open end buckets past their own labels', () => {
		const shoe = simulateRoundFrequency(SIX_DECK, HI_LO);
		const at = (trueCount: number) =>
			shoe.rounds.find((bucket) => bucket.trueCount === trueCount)!;

		// A whole bucket rounds to its label, so its mean sits within half a count
		// of it -- except at the open ends, which hold everything past them.
		expect(at(2).meanTrueCount).toBeGreaterThan(1.5);
		expect(at(2).meanTrueCount).toBeLessThan(2.5);
		expect(at(6).meanTrueCount).toBeGreaterThan(6.5);
		expect(at(-6).meanTrueCount).toBeLessThan(-6.5);

		// The mean square is at least the square of the mean, by Jensen, and much
		// more where the counts inside are spread widely about it.
		for (const bucket of shoe.rounds) {
			expect(bucket.meanSquaredTrueCount).toBeGreaterThanOrEqual(
				bucket.meanTrueCount * bucket.meanTrueCount - 1e-9
			);
		}
		expect(at(6).meanSquaredTrueCount).toBeGreaterThan(
			at(6).meanTrueCount * at(6).meanTrueCount
		);
	});

	it('keeps a mean-zero count mean-zero across the buckets', () => {
		const shoe = simulateRoundFrequency(SIX_DECK, HI_LO);
		const mean = shoe.rounds.reduce(
			(sum, bucket) => sum + bucket.frequency * bucket.meanTrueCount,
			0
		);
		expect(mean).toBeCloseTo(0, 2);
	});

	it('is symmetric about zero for a balanced system', () => {
		const shoe = simulateRoundFrequency(SIX_DECK, HI_LO);
		// The count is mean-zero, so a round is as likely to be dealt at +3 as at
		// -3. Monte Carlo, so this is a tolerance rather than an identity.
		for (const bucket of shoe.rounds.filter((entry) => entry.trueCount > 0)) {
			const mirror = shoe.rounds.find((entry) => entry.trueCount === -bucket.trueCount)!;
			expect(bucket.frequency).toBeCloseTo(mirror.frequency, 2);
		}
	});

	it('repeats exactly, since the shuffle is seeded', () => {
		expect(simulateRoundFrequency(SIX_DECK, HI_LO)).toEqual(
			simulateRoundFrequency(SIX_DECK, HI_LO)
		);
	});

	it('plays more of its rounds at an advantage the deeper the shoe is dealt', () => {
		const shallow = simulateRoundFrequency(
			{ ...SIX_DECK, penetrationPercent: 50 },
			HI_LO
		);
		const deep = simulateRoundFrequency({ ...SIX_DECK, penetrationPercent: 90 }, HI_LO);

		expect(deep.advantageShare).toBeGreaterThan(shallow.advantageShare);
		expect(atOrAbove(deep, 3)).toBeGreaterThan(atOrAbove(shallow, 3));
	});

	it('plays more of its rounds at an advantage the fewer decks it holds', () => {
		const small = simulateRoundFrequency({ ...SIX_DECK, decks: 2 }, HI_LO);
		expect(small.advantageShare).toBeGreaterThan(
			simulateRoundFrequency(SIX_DECK, HI_LO).advantageShare
		);
	});

	it('keeps a weak system nearer zero than a strong one', () => {
		// Not the size of its counts -- the Hi-Lo-equivalent axis has already
		// normalised those away. What is left is granularity: Ace-Five tags eight
		// cards of a single deck where Hi-Lo tags twenty times as many, so its count
		// sits at zero through stretches of the deal that move Hi-Lo's off it.
		const aceFive = simulateRoundFrequency(SINGLE_DECK, ACE_FIVE_TAGS);
		const hiLo = simulateRoundFrequency(SINGLE_DECK, HI_LO);

		expect(aceFive.advantageShare).toBeLessThan(hiLo.advantageShare);
	});

	it('plays every round at zero under a system that counts nothing', () => {
		const neutral = Object.fromEntries(
			Object.keys(ACE_FIVE_TAGS).map((rank) => [rank, 0])
		) as TagValues;
		const shoe = simulateRoundFrequency(SIX_DECK, neutral);

		expect(shoe.advantageShare).toBe(0);
		expect(shoe.meanAdvantageCount).toBe(0);
		for (const bucket of shoe.rounds) {
			expect(bucket.frequency).toBe(bucket.trueCount === 0 ? 1 : 0);
		}
	});

	/**
	 * The buckets are Hi-Lo-equivalent, not the system's own, so that each one can
	 * read exactly one step of the bet ramp -- see `ROUND_TRUE_COUNTS`. Filed under
	 * the system's own counts, a system whose counts run on a different axis lands
	 * its buckets between the ramp's steps: several buckets share a step and other
	 * steps drive no bucket at all, so the spread set at them does nothing.
	 *
	 * Converting the count as it is filed is what leaves the distribution below
	 * nearly the same for every system, which is the axis being shared. The little
	 * that is left of the difference is granularity, not scale. Filed in each
	 * system's own counts these three read 0.25, 0.37 and 0.42 instead.
	 */
	it("files rounds on the ramp's own count axis, whatever the system", () => {
		const shareFor = (tags: TagValues) =>
			simulateRoundFrequency(SIX_DECK, tags).advantageShare;

		// Ace-Five's counts run at under half Hi-Lo's, Zen's at nearly twice them.
		const hiLo = shareFor(HI_LO);
		expect(shareFor(ACE_FIVE_TAGS)).toBeCloseTo(hiLo, 1);
		expect(shareFor(tagsForSystem('zen')!)).toBeCloseTo(hiLo, 1);
	});
});
