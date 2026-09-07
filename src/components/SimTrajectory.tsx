/**
 * The walk: what the run actually paid as it went, against what the hands it had
 * played by then were worth, inside the ±1σ and ±2σ the same hands imply. Drawn
 * as SVG, in the manner of `CountEvGraph`.
 *
 * The x axis is rounds *dealt*, not rounds wagered on, because that is the run's
 * own clock -- so a stretch spent back-counting draws as the flat line it really
 * is rather than being compressed out of the picture.
 *
 * The point of the drawing is the width of the band. A session that finishes a
 * long way from its expectation has said nothing about the game — the bands are
 * what make that legible, where a single AV figure is not.
 */

import { createMemo, Show, type Component } from 'solid-js';

import { formatCurrency, formatRounds } from '#utils/format';
import type { SimSample } from '#utils/sim/run';

import '#styles/SimTrajectory';

/**
 * Laid out in these units and scaled to whatever width the card is given, so the
 * geometry below is arithmetic rather than measured pixels -- as the count graph
 * is. The paddings are the room the axis labels need.
 */
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 240;
const PAD_X = 46;
const PAD_TOP = 16;
const PAD_BOTTOM = 26;
const PLOT_WIDTH = VIEW_WIDTH - 2 * PAD_X;
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;

interface SimTrajectoryProps {
	samples: readonly SimSample[];
}

interface Plotted {
	x: number;
	av: number;
	ev: number;
	sd: number;
}

const SimTrajectory: Component<SimTrajectoryProps> = (props) => {
	const rounds = () => props.samples[props.samples.length - 1]?.rounds ?? 0;

	const plotted = createMemo<Plotted[]>(() => {
		const total = rounds();
		if (total <= 0) return [];
		return props.samples.map((sample) => ({
			x: PAD_X + (sample.rounds / total) * PLOT_WIDTH,
			av: sample.av,
			ev: sample.ev,
			sd: sample.sd,
		}));
	});

	/**
	 * The money axis. Zero is always on it -- a walk that never crossed back is
	 * still read against the line it started from -- and the ±2σ envelope is
	 * always inside it, since the whole point is how the walk sits in the band.
	 */
	const scale = createMemo(() => {
		const points = plotted();
		if (points.length === 0) return { low: -1, high: 1, span: 2 };
		let low = 0;
		let high = 0;
		for (const point of points) {
			low = Math.min(low, point.av, point.ev - 2 * point.sd);
			high = Math.max(high, point.av, point.ev + 2 * point.sd);
		}
		const span = Math.max(high - low, 1);
		const margin = span * 0.08;
		return { low: low - margin, high: high + margin, span: span + 2 * margin };
	});

	const yOf = (value: number): number => {
		const { high, span } = scale();
		return PAD_TOP + ((high - value) / span) * PLOT_HEIGHT;
	};

	const pathOf = (value: (point: Plotted) => number): string =>
		plotted()
			.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${yOf(value(point))}`)
			.join(' ');

	/** One σ-band, drawn out along its top edge and back along its bottom. */
	const bandOf = (sigmas: number): string => {
		const points = plotted();
		if (points.length === 0) return '';
		const top = points
			.map(
				(point, index) =>
					`${index === 0 ? 'M' : 'L'} ${point.x} ${yOf(point.ev + sigmas * point.sd)}`
			)
			.join(' ');
		const bottom = [...points]
			.reverse()
			.map((point) => `L ${point.x} ${yOf(point.ev - sigmas * point.sd)}`)
			.join(' ');
		return `${top} ${bottom} Z`;
	};

	const zeroY = () => yOf(0);
	const final = () => props.samples[props.samples.length - 1];

	const summary = () => {
		const last = final();
		if (last === undefined) return '';
		return `${formatCurrency(last.av)} over ${formatRounds(last.rounds)} rounds dealt, against ${formatCurrency(last.ev)} expected`;
	};

	return (
		<section class="sim-trajectory">
			<header class="sim-trajectory__header">
				<h2 class="sim-trajectory__title">The walk</h2>
			</header>
			<Show
				when={plotted().length > 1}
				fallback={
					<p class="sim-trajectory__empty">
						A finished run draws its money here, against the expectation of the hands it
						played.
					</p>
				}
			>
				<svg
					class="sim-trajectory__plot"
					viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
					role="img"
					aria-label={`The money won as the run went, against its expectation and the standard deviations either side of it. ${summary()}`}
				>
					<path class="sim-trajectory__band" d={bandOf(2)} />
					<path class="sim-trajectory__band is-inner" d={bandOf(1)} />
					<line
						class="sim-trajectory__zero"
						x1={PAD_X}
						y1={zeroY()}
						x2={VIEW_WIDTH - PAD_X}
						y2={zeroY()}
					/>
					<path class="sim-trajectory__expectation" d={pathOf((point) => point.ev)} />
					<path class="sim-trajectory__money" d={pathOf((point) => point.av)} />
					<text
						class="sim-trajectory__tick"
						x={PAD_X}
						y={VIEW_HEIGHT - 8}
						text-anchor="start"
					>
						0
					</text>
					<text
						class="sim-trajectory__tick"
						x={VIEW_WIDTH - PAD_X}
						y={VIEW_HEIGHT - 8}
						text-anchor="end"
					>
						{formatRounds(rounds())} rounds
					</text>
				</svg>
				<p class="sim-trajectory__reading">{summary()}</p>
			</Show>
		</section>
	);
};

export default SimTrajectory;
