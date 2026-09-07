/**
 * Where the play actually went: hands, share of the session, average bet and what
 * each Hi-Lo-equivalent true count paid per hand. The bucket a round is filed
 * under is `countRounds.ts`'s own, so this table and the Bankroll view's graph
 * cut the count line in the same places.
 */

import { For, type Component } from 'solid-js';

import { signClass } from '#utils/actionStyle';
import {
	formatCount,
	formatCurrency,
	formatEvCurrency,
	formatRounds,
} from '#utils/format';
import type { SimBucket } from '#utils/sim/run';

import '#styles/SimCountTable';

interface SimCountTableProps {
	buckets: readonly SimBucket[];
}

/** The two end buckets are open, and say so, as the bet ramp's headings do. */
function bucketLabel(trueCount: number, index: number, length: number): string {
	if (index === 0) return `≤${formatCount(trueCount)}`;
	if (index === length - 1) return `≥${formatCount(trueCount)}`;
	return formatCount(trueCount);
}

const SimCountTable: Component<SimCountTableProps> = (props) => {
	/** The busiest bucket, so the bars fill the column rather than a fraction of it. */
	const peak = () =>
		props.buckets.reduce((most, bucket) => Math.max(most, bucket.rounds), 0);

	return (
		<section class="sim-count-table">
			<h2 class="sim-count-table__title">Play by true count</h2>
			<div class="sim-count-table__scroll">
				<table class="sim-count-table__table">
					<thead>
						<tr>
							<th scope="col">TC</th>
							<th scope="col">Rounds</th>
							<th scope="col">Share</th>
							<th scope="col">Hands</th>
							<th scope="col">Avg bet</th>
							<th scope="col">AV/hand</th>
						</tr>
					</thead>
					<tbody>
						<For each={props.buckets}>
							{(bucket, index) => {
								// A bucket the shoe stood at but never wagered in: either
								// the wong settings sat it out or the ramp bets nothing
								// there. Shown, because the rounds still happened and the
								// count still moved, but greyed, because none of the money
								// columns describe anything.
								const satOut = () => bucket.rounds > 0 && bucket.roundsPlayed === 0;
								const share = () => (peak() > 0 ? (bucket.rounds / peak()) * 100 : 0);
								const avPerHand = () => (bucket.hands > 0 ? bucket.av / bucket.hands : 0);
								return (
									<tr class={satOut() ? 'is-sat-out' : ''}>
										<th scope="row">
											{bucketLabel(bucket.trueCount, index(), props.buckets.length)}
										</th>
										<td>{formatRounds(bucket.rounds)}</td>
										<td>
											{/*
											 * Drawn rather than styled: the bar's length is the
											 * datum, and an SVG geometry attribute carries it as
											 * data where an inline width would be a style. The
											 * graph card draws its own line the same way.
											 */}
											<svg
												class="sim-count-table__bar"
												viewBox="0 0 100 10"
												preserveAspectRatio="none"
												role="img"
												aria-label={`${share().toFixed(0)}% of the busiest count's rounds`}
											>
												<rect
													class="sim-count-table__bar-fill"
													x={0}
													y={0}
													width={share()}
													height={10}
												/>
											</svg>
										</td>
										<td>{formatRounds(bucket.hands)}</td>
										<td>
											{bucket.roundsPlayed > 0 ?
												formatCurrency(bucket.wagered / bucket.roundsPlayed).replace(
													'+',
													''
												)
											:	'—'}
										</td>
										<td class={signClass(avPerHand()) ?? ''}>
											{bucket.hands > 0 ? formatEvCurrency(avPerHand()) : '—'}
										</td>
									</tr>
								);
							}}
						</For>
					</tbody>
				</table>
			</div>
		</section>
	);
};

export default SimCountTable;
