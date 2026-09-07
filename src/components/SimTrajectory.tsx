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

import { createMemo, createSignal, For, Show, type Component } from 'solid-js';

import { signClass } from '#utils/actionStyle';
import { formatCurrency, formatRounds } from '#utils/format';
import type { SimSample } from '#utils/sim/run';

import '#styles/SimTrajectory';

/**
 * Laid out in these units and scaled to whatever width the card is given, so the
 * geometry below is arithmetic rather than measured pixels -- as the count graph
 * is. The paddings are the room the axis labels need: the money figures run to
 * five digits and a sign, so the left edge carries most of it.
 */
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 240;
const PAD_LEFT = 74;
const PAD_RIGHT = 18;
const PAD_TOP = 16;
const PAD_BOTTOM = 26;
const PLOT_WIDTH = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
/** Radius of the dots the pointer's own checkpoint is marked with. */
const MARKER_RADIUS = 4;

interface SimTrajectoryProps {
	samples: readonly SimSample[];
}

interface Plotted {
	index: number;
	x: number;
	rounds: number;
	av: number;
	ev: number;
	sd: number;
}

const SimTrajectory: Component<SimTrajectoryProps> = (props) => {
	// Which checkpoint the pointer (or the keyboard) is on, or `null` for none.
	// The popover it drives floats over the plot rather than living in the
	// caption as the count graph's reading does: there are four figures to give
	// per point here, and a line of them under a 200-point walk could not say
	// which point it was talking about.
	const [hovered, setHovered] = createSignal<number | null>(null);

	const rounds = () => props.samples[props.samples.length - 1]?.rounds ?? 0;

	const plotted = createMemo<Plotted[]>(() => {
		const total = rounds();
		if (total <= 0) return [];
		return props.samples.map((sample, index) => ({
			index,
			x: PAD_LEFT + (sample.rounds / total) * PLOT_WIDTH,
			rounds: sample.rounds,
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
		if (points.length === 0) return { low: -1, high: 1, span: 2, most: 1, least: -1 };
		let least = 0;
		let most = 0;
		for (const point of points) {
			least = Math.min(least, point.av, point.ev - 2 * point.sd);
			most = Math.max(most, point.av, point.ev + 2 * point.sd);
		}
		const span = Math.max(most - least, 1);
		const margin = span * 0.08;
		// `most` and `least` are the drawing's own extremes; `low` and `high` are
		// the axis they hang in, a margin wider so the extreme point isn't drawn
		// against the plot's edge.
		return {
			low: least - margin,
			high: most + margin,
			span: span + 2 * margin,
			most,
			least,
		};
	});

	const yOf = (value: number): number => {
		const { high, span } = scale();
		return PAD_TOP + ((high - value) / span) * PLOT_HEIGHT;
	};

	/**
	 * The money axis is marked at its ends rather than at even steps along it:
	 * the two figures worth reading off a walk are the furthest it got either
	 * way, and a ladder of round numbers between them only says what the axis is
	 * already saying. Zero is dropped from the set and drawn separately -- it is
	 * the line the run is read against, and it carries its own weight -- so a run
	 * that never lost money marks its floor once, not twice.
	 */
	const ticks = createMemo(() => {
		const { most, least } = scale();
		return [most, least].filter((value) => value !== 0);
	});

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

	const point = () => {
		const index = hovered();
		return index === null ? undefined : plotted()[index];
	};

	/** The checkpoint nearest a position given as a fraction of the plot's width. */
	const nearest = (fraction: number): number | null => {
		const points = plotted();
		if (points.length === 0) return null;
		const x = PAD_LEFT + fraction * PLOT_WIDTH;
		let best = 0;
		for (let index = 1; index < points.length; index += 1) {
			if (Math.abs(points[index].x - x) < Math.abs(points[best].x - x)) best = index;
		}
		return best;
	};

	const track = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
		const box = event.currentTarget.getBoundingClientRect();
		if (box.width <= 0) return;
		// The pointer is placed by where it sits in the *plot*, not in the svg, so
		// the axis gutters don't offset every reading by their own width.
		const fraction =
			((event.clientX - box.left) / box.width - PAD_LEFT / VIEW_WIDTH)
			* (VIEW_WIDTH / PLOT_WIDTH);
		setHovered(nearest(Math.min(Math.max(fraction, 0), 1)));
	};

	const step = (delta: number) => {
		const points = plotted();
		if (points.length === 0) return;
		const from = hovered() ?? points.length - 1;
		setHovered(Math.min(Math.max(from + delta, 0), points.length - 1));
	};

	const onKeyDown = (event: KeyboardEvent) => {
		switch (event.key) {
			case 'ArrowLeft':
				step(-1);
				break;
			case 'ArrowRight':
				step(1);
				break;
			case 'Home':
				setHovered(0);
				break;
			case 'End':
				setHovered(plotted().length - 1);
				break;
			case 'Escape':
				setHovered(null);
				return;
			default:
				return;
		}
		event.preventDefault();
	};

	/**
	 * Which corner of the plot the popover sits in. It is parked in a corner
	 * rather than carried along under the pointer: a box that chases x covers
	 * whatever it is standing over, and the run it is describing is the one thing
	 * that must stay visible. The crosshair is what ties the figures to a point,
	 * so the box itself is free to sit where there is nothing to hide.
	 *
	 * Across: the half the pointer is not in. Down: whichever half of that side
	 * the run and its band leave emptiest, measured over the checkpoints there --
	 * a walk running high puts the box at the floor and vice versa.
	 */
	const popoverCorner = createMemo(() => {
		const at = point();
		const points = plotted();
		if (at === undefined || points.length === 0) return undefined;

		const middle = PAD_LEFT + PLOT_WIDTH / 2;
		const onLeft = at.x > middle;

		// How far down the plot that side's drawing sits on average: the walk, and
		// both edges of the outer band, since the band takes up room of its own.
		let depth = 0;
		let counted = 0;
		for (const p of points) {
			if (onLeft ? p.x > middle : p.x < middle) continue;
			depth += (yOf(p.av) + yOf(p.ev + 2 * p.sd) + yOf(p.ev - 2 * p.sd)) / 3 - PAD_TOP;
			counted += 1;
		}
		return { onLeft, onTop: depth / Math.max(counted, 1) > PLOT_HEIGHT / 2 };
	});

	const popoverClass = () => {
		const corner = popoverCorner();
		if (corner === undefined) return '';
		return ` ${corner.onLeft ? 'is-left' : 'is-right'} ${corner.onTop ? 'is-top' : 'is-bottom'}`;
	};

	/**
	 * How far from its expectation the run stood at this checkpoint, in units of
	 * its own noise -- the same reading the summary band gives for the finished
	 * run, which is what says whether a gap in money is a large one.
	 */
	const deviation = (at: Plotted): string => {
		if (at.sd <= 0) return '—';
		const sigmas = (at.av - at.ev) / at.sd;
		return `${
			sigmas > 0 ? '+'
			: sigmas < 0 ? '-'
			: ''
		}${Math.abs(sigmas).toFixed(2)}σ`;
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
				<div class="sim-trajectory__figure">
					<svg
						class="sim-trajectory__plot"
						viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
						role="img"
						tabindex="0"
						aria-label={`The money won as the run went, against its expectation and the standard deviations either side of it. ${summary()}`}
						onPointerMove={track}
						onPointerLeave={() => setHovered(null)}
						onFocus={() => setHovered(plotted().length - 1)}
						onBlur={() => setHovered(null)}
						onKeyDown={onKeyDown}
					>
						<For each={ticks()}>
							{(value) => (
								<>
									<line
										class="sim-trajectory__grid"
										x1={PAD_LEFT}
										y1={yOf(value)}
										x2={VIEW_WIDTH - PAD_RIGHT}
										y2={yOf(value)}
									/>
									<text
										class="sim-trajectory__tick"
										x={PAD_LEFT - 10}
										y={yOf(value) + 4}
										text-anchor="end"
									>
										{formatCurrency(value)}
									</text>
								</>
							)}
						</For>
						<path class="sim-trajectory__band" d={bandOf(2)} />
						<path class="sim-trajectory__band is-inner" d={bandOf(1)} />
						<line
							class="sim-trajectory__zero"
							x1={PAD_LEFT}
							y1={zeroY()}
							x2={VIEW_WIDTH - PAD_RIGHT}
							y2={zeroY()}
						/>
						<text
							class="sim-trajectory__tick"
							x={PAD_LEFT - 10}
							y={zeroY() + 4}
							text-anchor="end"
						>
							{formatCurrency(0)}
						</text>
						<path class="sim-trajectory__expectation" d={pathOf((p) => p.ev)} />
						<path class="sim-trajectory__money" d={pathOf((p) => p.av)} />
						<Show when={point()}>
							{(at) => (
								<g class="sim-trajectory__marker">
									<line
										class="sim-trajectory__crosshair"
										x1={at().x}
										y1={PAD_TOP}
										x2={at().x}
										y2={PAD_TOP + PLOT_HEIGHT}
									/>
									<circle
										class="sim-trajectory__dot is-expectation"
										cx={at().x}
										cy={yOf(at().ev)}
										r={MARKER_RADIUS}
									/>
									<circle
										class="sim-trajectory__dot"
										cx={at().x}
										cy={yOf(at().av)}
										r={MARKER_RADIUS}
									/>
								</g>
							)}
						</Show>
						<text
							class="sim-trajectory__tick"
							x={PAD_LEFT}
							y={VIEW_HEIGHT - 8}
							text-anchor="start"
						>
							0
						</text>
						<text
							class="sim-trajectory__tick"
							x={VIEW_WIDTH - PAD_RIGHT}
							y={VIEW_HEIGHT - 8}
							text-anchor="end"
						>
							{formatRounds(rounds())} rounds
						</text>
					</svg>
					{/*
					 * Not a live region, and not focusable: it answers the pointer, and
					 * the figures it holds are the ones the caption and the summary band
					 * already carry for a reader that cannot hover.
					 */}
					<Show when={point()}>
						{(at) => (
							<div class={`sim-trajectory__popover${popoverClass()}`} aria-hidden="true">
								<div class="sim-trajectory__popover-head">
									{formatRounds(at().rounds)} rounds
								</div>
								<div class="sim-trajectory__popover-grid">
									<span>Result</span>
									<span class={signClass(at().av)}>{formatCurrency(at().av)}</span>
									<span>Expected</span>
									<span class={signClass(at().ev)}>{formatCurrency(at().ev)}</span>
									<span>Difference</span>
									<span class={signClass(at().av - at().ev)}>
										{formatCurrency(at().av - at().ev)}
									</span>
									<span>Deviation</span>
									<span class={signClass(at().av - at().ev)}>{deviation(at())}</span>
									<span>±1σ</span>
									<span>
										{formatCurrency(at().ev - at().sd)} …{' '}
										{formatCurrency(at().ev + at().sd)}
									</span>
								</div>
							</div>
						)}
					</Show>
				</div>
				<ul class="sim-trajectory__legend">
					<li>
						<i class="sim-trajectory__swatch is-money" /> Result
					</li>
					<li>
						<i class="sim-trajectory__swatch is-expectation" /> Expectation
					</li>
					<li>
						<i class="sim-trajectory__swatch is-inner-band" /> ±1σ
					</li>
					<li>
						<i class="sim-trajectory__swatch is-band" /> ±2σ
					</li>
				</ul>
				<p class="sim-trajectory__reading">{summary()}</p>
			</Show>
		</section>
	);
};

export default SimTrajectory;
