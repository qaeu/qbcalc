/**
 * How a shoe's rounds are spread across the true count, as a histogram: the shoe
 * the settings describe, rather than the one hand the grids price. Purely a
 * function of the counting system, the shoe size and the penetration -- see
 * docs/count-rounds-model.md.
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js';

import { ROUND_TRUE_COUNTS, type RoundFrequency } from '#utils/countRounds';
import { formatCount, formatPercent } from '#utils/format';
import { loadingPhase } from '#utils/loadingPhase';

import '#styles/CountFrequencyGraph';

/** Everything the card draws, taken together so it can only ever show one shoe. */
export interface CountFrequencyProfile {
	/** The simulated round shares, over `ROUND_TRUE_COUNTS`. */
	rounds: RoundFrequency;
	decks: number;
	penetrationPercent: number;
	/** Display name of the counting system the tags came from. */
	systemLabel: string;
}

/**
 * The drawing is laid out in these units and scaled to whatever width the card
 * gets, so the geometry below is plain arithmetic rather than measured pixels.
 * The paddings are the room the labels need: the tallest column's figure above
 * the columns, and the counts below them.
 */
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 190;
const PAD_X = 10;
const PAD_TOP = 28;
const PAD_BOTTOM = 26;
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
const BASELINE = PAD_TOP + PLOT_HEIGHT;
const BAND_WIDTH = (VIEW_WIDTH - 2 * PAD_X) / ROUND_TRUE_COUNTS.length;
/** Columns fill their band bar a gap, which is what separates them -- no strokes. */
const COLUMN_GAP = 4;
const COLUMN_WIDTH = BAND_WIDTH - COLUMN_GAP;
const CORNER_RADIUS = 4;

interface Column {
	/** Index into the profile's buckets. */
	index: number;
	trueCount: number;
	label: string;
	frequency: number;
	/** Left edge of the whole band, which is the hover target. */
	bandX: number;
	x: number;
	y: number;
	height: number;
}

/** A column with a rounded cap and square feet, grown from the baseline. */
function columnPath(x: number, y: number, width: number, height: number): string {
	const r = Math.min(CORNER_RADIUS, width / 2, height);
	const right = x + width;
	return (
		`M ${x} ${BASELINE} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y}`
		+ ` L ${right - r} ${y} Q ${right} ${y} ${right} ${y + r} L ${right} ${BASELINE} Z`
	);
}

/** The two end buckets are open, and say so, as the bet ramp's headings do. */
function bucketLabel(trueCount: number, index: number, length: number): string {
	if (index === 0) return `≤${formatCount(trueCount)}`;
	if (index === length - 1) return `≥${formatCount(trueCount)}`;
	return formatCount(trueCount);
}

interface CountFrequencyGraphProps {
	/** The shoe to draw, or `undefined` before there is one. */
	profile: CountFrequencyProfile | undefined;
	loading: boolean;
	/** Where the skeleton starts in the pulse cycle, as with the summary cards. */
	seed: number;
}

const CountFrequencyGraph: Component<CountFrequencyGraphProps> = (props) => {
	// Which column the pointer is on, or `null` for none. The reading it drives
	// sits in the caption under the graph rather than in a floating tooltip:
	// there is one number per column, and a fixed line cannot cover the data it
	// is describing.
	const [hovered, setHovered] = createSignal<number | null>(null);

	const columns = createMemo<Column[]>(() => {
		const shares = props.profile?.rounds.rounds ?? [];
		// Scaled to the tallest column rather than to a fixed percentage: a deeply
		// dealt single deck spreads its rounds over the whole range where a shallow
		// eight-deck shoe piles them onto zero, and a fixed scale would flatten one
		// of the two into nothing.
		const tallest = Math.max(...shares.map((bucket) => bucket.frequency), 0);
		return shares.map((bucket, index) => {
			const height = tallest > 0 ? (bucket.frequency / tallest) * PLOT_HEIGHT : 0;
			const bandX = PAD_X + index * BAND_WIDTH;
			return {
				index,
				trueCount: bucket.trueCount,
				label: bucketLabel(bucket.trueCount, index, shares.length),
				frequency: bucket.frequency,
				bandX,
				x: bandX + COLUMN_GAP / 2,
				y: BASELINE - height,
				height,
			};
		});
	});

	/** The tallest column, which is the only one labelled where it stands. */
	const peakIndex = createMemo(() => {
		const all = columns();
		return all.reduce(
			(best, column) => (column.frequency > all[best].frequency ? column.index : best),
			0
		);
	});

	const summary = createMemo(() => {
		const rounds = props.profile?.rounds;
		if (!rounds) return '';
		const dealt = Math.round(rounds.roundsPerShoe);
		return (
			`A shoe deals about ${dealt} rounds, of which`
			+ ` ${formatPercent(rounds.advantageShare * 100)} are played at +1 or better.`
		);
	});

	const reading = createMemo(() => {
		const index = hovered();
		if (index === null) return summary();
		const column = columns()[index];
		const share = formatPercent(column.frequency * 100);
		const perShoe = (props.profile?.rounds.roundsPerShoe ?? 0) * column.frequency;
		return (
			`${share} of rounds are played at ${column.label}`
			+ ` -- about ${perShoe.toFixed(1)} a shoe.`
		);
	});

	const caption = createMemo(() => {
		const profile = props.profile;
		if (!profile) return '';
		return `${profile.decks} decks · ${profile.penetrationPercent}% penetration · ${profile.systemLabel}`;
	});

	return (
		<section class="count-frequency-graph">
			<header class="count-frequency-graph__header">
				<h2 class="count-frequency-graph__title">True count frequency</h2>
				<Show when={!props.loading && props.profile}>
					<span class="count-frequency-graph__caption">{caption()}</span>
				</Show>
			</header>
			<Show
				when={!props.loading && props.profile}
				fallback={
					<div
						class={`count-frequency-graph__skeleton count-frequency-graph__loading-phase-${loadingPhase(
							props.seed,
							0,
							0
						)}`}
						aria-hidden="true"
					/>
				}
			>
				<svg
					class="count-frequency-graph__plot"
					viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
					role="img"
					aria-label={`Share of a shoe's rounds played at each true count. ${summary()}`}
					onMouseLeave={() => setHovered(null)}
				>
					<line
						class="count-frequency-graph__baseline"
						x1={PAD_X}
						y1={BASELINE}
						x2={VIEW_WIDTH - PAD_X}
						y2={BASELINE}
					/>
					<For each={columns()}>
						{(column) => (
							<g
								class="count-frequency-graph__band"
								onMouseEnter={() => setHovered(column.index)}
							>
								{/*
								 * The hit target is the whole band, not the column: the
								 * short ones at the tails are a couple of units tall and
								 * would otherwise be impossible to point at.
								 */}
								<rect
									class="count-frequency-graph__hit"
									x={column.bandX}
									y={PAD_TOP}
									width={BAND_WIDTH}
									height={PLOT_HEIGHT}
								/>
								<Show when={column.height > 0}>
									<path
										class={`count-frequency-graph__column${
											column.trueCount > 0 ? ' is-advantage' : ''
										}${hovered() === column.index ? ' is-hovered' : ''}`}
										d={columnPath(column.x, column.y, COLUMN_WIDTH, column.height)}
									/>
								</Show>
								<text
									class="count-frequency-graph__tick"
									x={column.bandX + BAND_WIDTH / 2}
									y={VIEW_HEIGHT - 8}
									text-anchor="middle"
								>
									{column.label}
								</text>
								{/*
								 * Only the tallest is labelled where it stands; every
								 * other figure is a hover away, and a number over each
								 * column would bury the shape they are drawn to show.
								 */}
								<Show when={column.index === peakIndex()}>
									<text
										class="count-frequency-graph__peak"
										x={column.bandX + BAND_WIDTH / 2}
										y={column.y - 8}
										text-anchor="middle"
									>
										{formatPercent(column.frequency * 100)}
									</text>
								</Show>
							</g>
						)}
					</For>
				</svg>
				{/*
				 * Not a live region: the reading follows the pointer, so announcing
				 * every column it crosses would be noise. The graph's own label
				 * carries the same summary for a reader that cannot hover.
				 */}
				<p class="count-frequency-graph__reading">{reading()}</p>
			</Show>
		</section>
	);
};

export default CountFrequencyGraph;
