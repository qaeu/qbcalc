/**
 * Where a shoe's expectation actually comes from: each true count's edge
 * weighted by how much of the play happens at it and by how much the bet spread
 * puts on it, drawn as a line across the count and priced in money. The shoe the
 * settings describe, rather than the one hand the grids price -- see
 * docs/count-rounds-model.md.
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js';

import { betAtCount, edgeAtCount, type EdgeCurve } from '#utils/bankroll';
import { ROUND_TRUE_COUNTS, type RoundFrequency } from '#utils/countRounds';
import {
	formatCount,
	formatEvCurrency,
	formatEvPercent,
	formatHands,
} from '#utils/format';
import { loadingPhase } from '#utils/loadingPhase';

import '#styles/CountEvGraph';

/** Everything the card draws, taken together so it can only ever show one shoe. */
export interface CountEvProfile {
	/**
	 * The simulated round shares, over `ROUND_TRUE_COUNTS` -- Hi-Lo-equivalent
	 * counts, the axis the ramp is denominated on.
	 */
	rounds: RoundFrequency;
	/** The edge curve the buckets are priced through, in the system's own counts. */
	edge: EdgeCurve;
	/** Units bet in each `RAMP_TRUE_COUNTS` bucket -- the spread as it is set. */
	ramp: readonly number[];
	/**
	 * How many of the system's own true counts one Hi-Lo count is worth, which is
	 * what a bucket's Hi-Lo-equivalent count is converted through before the edge
	 * curve prices it. See `hiLoCountScale` and docs/bankroll-model.md §The ramp's
	 * count axis.
	 */
	countScale: number;
	/** What one betting unit is worth, which is what puts the line in money. */
	unit: number;
	decks: number;
	penetrationPercent: number;
	/** Display name of the counting system the tags came from. */
	systemLabel: string;
}

/**
 * The drawing is laid out in these units and scaled to whatever width the card
 * gets, so the geometry below is plain arithmetic rather than measured pixels.
 * The paddings are the room the labels need: the extreme point's figure beside
 * the line, and the counts under the plot.
 */
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 190;
const PAD_X = 10;
const PAD_TOP = 28;
const PAD_BOTTOM = 26;
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
const BAND_WIDTH = (VIEW_WIDTH - 2 * PAD_X) / ROUND_TRUE_COUNTS.length;
/** Radius of a point on the line, and of the fatter one the pointer is on. */
const POINT_RADIUS = 3;
const HOVERED_POINT_RADIUS = 5;

interface Point {
	/** Index into the profile's buckets. */
	index: number;
	trueCount: number;
	label: string;
	/** The bucket's share of the play, as hands of an average shoe. */
	hands: number;
	/** Units the spread bets into this bucket. */
	bet: number;
	/** The edge at the counts this bucket holds, in percent. */
	edgePercent: number;
	/** What this bucket contributes to an average shoe, in money -- what is plotted. */
	weightedEv: number;
	/** Left edge of the whole band, which is the hover target. */
	bandX: number;
	x: number;
	y: number;
}

/** The two end buckets are open, and say so, as the bet ramp's headings do. */
function bucketLabel(trueCount: number, index: number, length: number): string {
	if (index === 0) return `≤${formatCount(trueCount)}`;
	if (index === length - 1) return `≥${formatCount(trueCount)}`;
	return formatCount(trueCount);
}

interface CountEvGraphProps {
	/** The shoe to draw, or `undefined` before there is one. */
	profile: CountEvProfile | undefined;
	loading: boolean;
	/** Where the skeleton starts in the pulse cycle, as with the summary cards. */
	seed: number;
}

const CountEvGraph: Component<CountEvGraphProps> = (props) => {
	// Which point the pointer is on, or `null` for none. The reading it drives
	// sits in the caption under the graph rather than in a floating tooltip:
	// there is one number per bucket, and a fixed line cannot cover the data it
	// is describing.
	const [hovered, setHovered] = createSignal<number | null>(null);

	/**
	 * The plotted value of every bucket, before it is given a position: the
	 * bucket's edge -- priced at the counts it actually holds, not at its label --
	 * under the weight of how often the bucket comes up and how many units the
	 * spread bets into it, in money. Percent of a unit becomes pounds through the
	 * unit; a round becomes a shoe through the rounds the simulation dealt before
	 * the cut. The sum across the line is then what the spread makes on an average
	 * shoe.
	 *
	 * Deliberately not divided by the average bet, which would turn the total back
	 * into the same per-unit-wagered edge the summary card above reports. The two
	 * would not quite agree -- the card integrates a normal distribution where this
	 * simulates a real shoe (count-rounds-model.md §The same question as the
	 * bankroll model's) -- and two figures for one quantity that differ in the
	 * second decimal read as a bug rather than as two methods.
	 */
	const values = createMemo(() => {
		const profile = props.profile;
		if (!profile) return [];
		const scale = profile.countScale;
		const priced = profile.rounds.rounds.map((bucket) => {
			return {
				trueCount: bucket.trueCount,
				frequency: bucket.frequency,
				// The buckets are already on the ramp's own Hi-Lo-equivalent axis, so
				// the spread is read straight off them -- one bucket per step, with
				// nothing rounded away.
				bet: betAtCount(profile.ramp, bucket.meanTrueCount),
				// The edge curve is in the system's own counts, though, so the bucket's
				// moments are converted back into them here -- the same meeting point
				// `analyzeBankroll` makes for the summary cards.
				edgePercent: edgeAtCount(
					profile.edge,
					scale * bucket.meanTrueCount,
					scale * scale * bucket.meanSquaredTrueCount
				),
			};
		});
		const perShoe = (profile.unit / 100) * profile.rounds.roundsPerShoe;
		return priced.map((value) => ({
			...value,
			weightedEv: value.frequency * value.bet * value.edgePercent * perShoe,
		}));
	});

	/**
	 * The value axis. Zero is always on it -- the line crosses from losing counts
	 * to winning ones, and a scale that cropped the crossing would hide the whole
	 * point of the drawing -- but it is not centred: the negative half of the shoe
	 * carries far more weight than the positive one, and a symmetric scale would
	 * squash the winning end into the axis.
	 */
	const scale = createMemo(() => {
		const plotted = values().map((value) => value.weightedEv);
		const low = Math.min(0, ...plotted);
		const high = Math.max(0, ...plotted);
		const span = high - low;
		if (span <= 0) return { low: -1, high: 1, span: 2 };
		// A margin either side, so the extreme points and their label sit inside
		// the plot rather than on its edge.
		const margin = span * 0.12;
		return { low: low - margin, high: high + margin, span: span + 2 * margin };
	});

	const points = createMemo<Point[]>(() => {
		const { high, span } = scale();
		const all = values();
		return all.map((value, index) => {
			const bandX = PAD_X + index * BAND_WIDTH;
			return {
				index,
				trueCount: value.trueCount,
				label: bucketLabel(value.trueCount, index, all.length),
				hands: value.frequency * (props.profile?.rounds.roundsPerShoe ?? 0),
				bet: value.bet,
				edgePercent: value.edgePercent,
				weightedEv: value.weightedEv,
				bandX,
				x: bandX + BAND_WIDTH / 2,
				y: PAD_TOP + ((high - value.weightedEv) / span) * PLOT_HEIGHT,
			};
		});
	});

	/** Where a weighted EV of zero sits, which is the line the fills are cut on. */
	const zeroY = createMemo(() => {
		const { high, span } = scale();
		return PAD_TOP + (high / span) * PLOT_HEIGHT;
	});

	const linePath = createMemo(() =>
		points()
			.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
			.join(' ')
	);

	/** The same line closed onto the zero axis, which the two fills are clipped out of. */
	const areaPath = createMemo(() => {
		const all = points();
		if (all.length === 0) return '';
		const first = all[0];
		const last = all[all.length - 1];
		return `${linePath()} L ${last.x} ${zeroY()} L ${first.x} ${zeroY()} Z`;
	});

	/** The point furthest from zero, which is the only one labelled where it stands. */
	const peakIndex = createMemo(() => {
		const all = points();
		if (all.length === 0) return 0;
		return all.reduce(
			(best, point) =>
				Math.abs(point.weightedEv) > Math.abs(all[best].weightedEv) ? point.index : best,
			0
		);
	});

	/** What the spread makes on an average shoe: the line summed across. */
	const totalEv = createMemo(() =>
		values().reduce((sum, value) => sum + value.weightedEv, 0)
	);

	/**
	 * Hands the shoe deals before the cut, which is what the total is "per" --
	 * rounded, because a shoe of 46.8 hands is an average over the simulated
	 * shoes and reads as false precision beside a figure in pounds.
	 */
	const handsPerShoe = createMemo(() =>
		Math.round(props.profile?.rounds.roundsPerShoe ?? 0)
	);

	const summary = createMemo(
		() => `${formatEvCurrency(totalEv())} per ${formatHands(handsPerShoe())} hand shoe`
	);

	const reading = createMemo(() => {
		const index = hovered();
		if (index === null) return summary();
		const point = points()[index];
		return `${formatHands(point.hands)} hands @${formatEvPercent(point.edgePercent)}% EV`;
	});

	return (
		<section class="count-ev-graph">
			<header class="count-ev-graph__header">
				<h2 class="count-ev-graph__title">Shoe EV by TC</h2>
			</header>
			<Show
				when={!props.loading && props.profile}
				fallback={
					<>
						<div
							class={`count-ev-graph__skeleton count-ev-graph__loading-phase-${loadingPhase(
								props.seed,
								0,
								0
							)}`}
							aria-hidden="true"
						/>
						{/*
						 * Empty but otherwise identical to the real reading paragraph, so
						 * its line box reserves the same space and the card doesn't grow
						 * once the reading appears.
						 */}
						<p class="count-ev-graph__reading" aria-hidden="true">
							&nbsp;
						</p>
					</>
				}
			>
				<svg
					class="count-ev-graph__plot"
					viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
					role="img"
					aria-label={`What each Hi-Lo-equivalent true count contributes to a shoe: its player edge, weighted by how often it is played and by what the spread bets there, in money. ${summary()}`}
					onMouseLeave={() => setHovered(null)}
				>
					{/*
					 * The fill is cut on the zero axis rather than drawn twice from it,
					 * so the two halves meet exactly where the line crosses -- which is
					 * a point between buckets, not one the data holds.
					 */}
					<defs>
						<clipPath id="count-ev-graph-above">
							<rect x={0} y={PAD_TOP} width={VIEW_WIDTH} height={zeroY() - PAD_TOP} />
						</clipPath>
						<clipPath id="count-ev-graph-below">
							<rect
								x={0}
								y={zeroY()}
								width={VIEW_WIDTH}
								height={PAD_TOP + PLOT_HEIGHT - zeroY()}
							/>
						</clipPath>
					</defs>
					<path
						class="count-ev-graph__area is-advantage"
						d={areaPath()}
						clip-path="url(#count-ev-graph-above)"
					/>
					<path
						class="count-ev-graph__area"
						d={areaPath()}
						clip-path="url(#count-ev-graph-below)"
					/>
					<line
						class="count-ev-graph__zero"
						x1={PAD_X}
						y1={zeroY()}
						x2={VIEW_WIDTH - PAD_X}
						y2={zeroY()}
					/>
					<path class="count-ev-graph__line" d={linePath()} />
					<For each={points()}>
						{(point) => (
							<g
								class="count-ev-graph__band"
								onMouseEnter={() => setHovered(point.index)}
							>
								{/*
								 * The hit target is the whole band, not the point: a circle
								 * a few units across would be impossible to point at, and
								 * the line is read column by column anyway.
								 */}
								<rect
									class="count-ev-graph__hit"
									x={point.bandX}
									y={PAD_TOP}
									width={BAND_WIDTH}
									height={PLOT_HEIGHT}
								/>
								<circle
									class={`count-ev-graph__point${
										point.weightedEv > 0 ? ' is-advantage' : ''
									}${hovered() === point.index ? ' is-hovered' : ''}`}
									cx={point.x}
									cy={point.y}
									r={hovered() === point.index ? HOVERED_POINT_RADIUS : POINT_RADIUS}
								/>
								<text
									class="count-ev-graph__tick"
									x={point.x}
									y={VIEW_HEIGHT - 8}
									text-anchor="middle"
								>
									{point.label}
								</text>
								{/*
								 * The point furthest from zero is labelled where it stands so
								 * the shape has one number to anchor it; any other point adds
								 * its own label only while the pointer is on it, rather than
								 * burying the line under a number per point at rest.
								 */}
								<Show when={point.index === peakIndex() || hovered() === point.index}>
									<text
										class="count-ev-graph__peak"
										x={point.x}
										// Below the point where the line dips and above it where
										// it rises, so the label sits outside the fill rather
										// than on it -- unless the trough runs so deep that
										// below would land in the tick row, which is what the
										// plot's own floor guards.
										y={
											point.weightedEv < 0 && point.y + 18 <= PAD_TOP + PLOT_HEIGHT ?
												point.y + 18
											:	point.y - 10
										}
										text-anchor="middle"
									>
										{formatEvCurrency(point.weightedEv)}
									</text>
								</Show>
							</g>
						)}
					</For>
				</svg>
				{/*
				 * Not a live region: the reading follows the pointer, so announcing
				 * every bucket it crosses would be noise. The graph's own label
				 * carries the same summary for a reader that cannot hover.
				 */}
				<p class="count-ev-graph__reading">{reading()}</p>
			</Show>
		</section>
	);
};

export default CountEvGraph;
