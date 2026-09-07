/**
 * Attributing the sim's residual AV-over-EV gap.
 *
 * Skipped unless `QBCALC_ATTRIBUTION` is set, because these are measurements
 * rather than assertions: they cost minutes, they print tables meant to be read,
 * and what they found is written up in docs/sim-model.md §What the residual is
 * rather than pinned by a tolerance here. A statistical calibration test in the
 * default suite would have to band so widely to be reliable that it would assert
 * almost nothing; where an experiment here turns up a settlement defect, the
 * regression cover for it is a deterministic scripted-shoe test instead, in the
 * style of the two that pin the split-ace payout in tests/utils/play/game.test.ts.
 *
 *   QBCALC_ATTRIBUTION=1 npx vitest run --project unit \
 *     --disableConsoleIntercept tests/utils/sim/attribution.test.ts
 *
 * The whole sweep is single-digit minutes. `QBCALC_ATTRIBUTION_ROUNDS` sets the
 * rounds per seed (20 seeds), so it can be run short while it is being changed
 * and long when it is being read.
 */

import { describe, it, expect } from 'vitest';

import { HI_LO_TAGS } from '#utils/countingSystems';
import { baseComposition } from '#utils/ev/composition';
import { createRun } from '#utils/sim/run';

import {
	ARMS,
	armInputs,
	createAttributor,
	formatArmTable,
	formatAttribution,
	measureArm,
	measureFrame,
	remainingComposition,
	SEEDS,
} from './attribution';

/**
 * The repo carries no Node types -- everything else it builds runs in a browser
 * -- so the one global these measurements read is declared here rather than
 * pulling `@types/node` into the whole project for it.
 */
declare const process: { env: Record<string, string | undefined> };

const ENABLED = Boolean(process.env.QBCALC_ATTRIBUTION);

/**
 * Rounds per seed. The default puts about 35M rounds through each arm, which is
 * what a standard error of 0.02 points on the gap costs -- small enough to call
 * a 0.15-point residual present or absent.
 */
const ROUNDS_PER_SEED = Number(process.env.QBCALC_ATTRIBUTION_ROUNDS ?? 1_750_000);

/** Minutes, not seconds: each arm deals tens of millions of rounds. */
const SWEEP_TIMEOUT_MS = 60 * 60_000;

describe.skipIf(!ENABLED)('the sim’s residual AV-over-EV gap', () => {
	describe('Phase A -- frame or disagreement?', () => {
		it(
			'reads the gap on a shoe priced at the composition it is dealt from',
			{ timeout: SWEEP_TIMEOUT_MS },
			() => {
				// A blind count prices every round off the base composition, and a cut
				// card three percent in means the shoe is always within a few cards of
				// a full one. So the priced frame *is* the dealt one, and whatever gap
				// survives cannot be about the frame.
				const control = ARMS[0];
				const gap = measureArm(control, ROUNDS_PER_SEED);

				report(
					'Phase A: control arm',
					formatArmTable([{ arm: control, gap }]),
					gap.gapPoints > 4 * gap.standardErrorPoints ?
						'DISAGREEMENT: the game pays something the grids do not price -- go to Phase C.'
					:	'FRAME: the residual is not in the settlement rules -- go to Phase B.'
				);

				// The one thing that is asserted rather than read: the run is big
				// enough for its own answer to mean something.
				expect(gap.rounds).toBeGreaterThan(1_000_000);
				expect(gap.standardErrorPoints).toBeLessThan(0.05);
			}
		);
	});

	describe('Phase B -- the frame error, without money noise', () => {
		it(
			'prices the same opening decision against the frame and against the shoe',
			{ timeout: SWEEP_TIMEOUT_MS },
			() => {
				// Predictions, not outcomes: no settlement variance, so a couple of
				// thousand rounds resolve what tens of millions of dealt ones would.
				const lines: string[] = [
					'arm         tags   pen  rounds   frameΔ   ±1SE  ownCardsΔ   ±1SE  disagreed',
				];
				for (const arm of ARMS) {
					const reading = measureFrame(
						// Headroom, because a sampled round is skipped where there is no
						// opening decision to price: a shuffle due, a natural either
						// side, or an insurance offer the grids carry no cell for.
						armInputs(arm, SEEDS[0], FRAME_SAMPLE * FRAME_EVERY * 4),
						FRAME_SAMPLE,
						FRAME_EVERY
					);
					lines.push(
						[
							arm.name.padEnd(11),
							(arm.tags === HI_LO_TAGS ? 'Hi-Lo' : 'null').padEnd(6),
							`${arm.penetrationPercent}%`.padStart(4),
							String(reading.rounds).padStart(7),
							reading.framePoints.toFixed(3).padStart(8),
							reading.standardErrorPoints.toFixed(3).padStart(6),
							reading.ownCardsPoints.toFixed(3).padStart(10),
							reading.ownCardsStandardErrorPoints.toFixed(3).padStart(6),
							`${reading.actionDisagreements}/${reading.rounds}`.padStart(11),
						].join(' ')
					);
					// A frame error is a difference between two prices, so it must be
					// finite and small; anything else means the two grids are not
					// describing the same hand.
					expect(Number.isFinite(reading.framePoints)).toBe(true);
					expect(reading.rounds).toBe(FRAME_SAMPLE);
				}
				report(
					'Phase B: frame error, in points of edge',
					lines.join('\n'),
					'frameΔ = actual shoe − priced frame; ownCardsΔ = the same shoe less the '
						+ 'player’s\ntwo cards − the same shoe with them still in it. Positive means '
						+ 'the real hand was\nworth more than the way it was priced.'
				);
			}
		);

		it('reproduces exactly from its seed', () => {
			// The whole point of a measurement is that it can be taken twice. Small
			// enough to run in a second, so it also guards the harness itself.
			const inputs = armInputs(ARMS[2], SEEDS[0], 20_000);
			const first = measureFrame(inputs, 40, 17);
			const second = measureFrame(inputs, 40, 17);
			expect(second.framePoints).toBe(first.framePoints);
			expect(second.predictions).toEqual(first.predictions);
		});

		it('tallies a shoe that has dealt nothing back to its own composition', () => {
			const inputs = armInputs(ARMS[2], SEEDS[0], 1);
			const run = createRun(inputs);
			const comp = remainingComposition(run.game.shoe);
			expect([...comp]).toEqual([...baseComposition(inputs.ruleSet)]);
		});
	});

	describe('Phase C -- per-cell attribution', () => {
		it(
			'decomposes the gap over the cells the money went out on',
			{ timeout: SWEEP_TIMEOUT_MS },
			() => {
				// Run on the *control* arm rather than the one the app resembles.
				// Under Hi-Lo at real penetration the gap is mostly frame error
				// (Phase B), which is spread thinly over every cell and would bury
				// what this table is looking for. With the frame removed, any
				// contribution left is the game and the grids disagreeing.
				const arm = ARMS[0];
				const attributor = createAttributor();
				const gap = measureArm(arm, ROUNDS_PER_SEED, attributor.observe);
				const rows = attributor.rank();

				// The decomposition is exact by construction, and this is the check
				// that it stayed that way: the contributions sum to the whole gap.
				const summed = rows.reduce((sum, row) => sum + row.contributionPoints, 0);
				expect(summed).toBeCloseTo(gap.gapPoints, 6);

				report(
					`Phase C: ${rows.length} cell/action pairs over ${gap.rounds} rounds`,
					formatAttribution(rows, 30),
					`gap ${gap.gapPoints.toFixed(3)} ± ${gap.standardErrorPoints.toFixed(3)} points; `
						+ 'rows marked "no" are too thin to resolve a one-point cell error.'
				);
			}
		);
	});
});

/**
 * How many rounds Phase B prices twice, and how far apart it samples them.
 * Pricing a grid set at fast precision is about 35ms and a sampled round builds
 * two, so five thousand of them is a couple of minutes an arm -- and buys a
 * standard error around 0.04 points, which is what it takes to call the frame
 * reading nonzero.
 */
const FRAME_SAMPLE = 5_000;
const FRAME_EVERY = 37;

/** Prints a measurement where `--disableConsoleIntercept` will show it. */
function report(title: string, table: string, note: string): void {
	console.log(`\n=== ${title} ===\n${table}\n${note}\n`);
}
