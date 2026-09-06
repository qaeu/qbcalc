import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	Show,
	type Component,
} from 'solid-js';

import { analyzeBankroll, hiLoCountScale, type BankrollAnalysis } from '#utils/bankroll';
import { labelForSystem } from '#utils/countingSystems';
import { baseComposition } from '#utils/ev/composition';
import { simulateRoundFrequency, type RoundFrequency } from '#utils/countRounds';
import { createHashRoute } from '#utils/hashRoute';
import { COMPACT_LAYOUT_QUERY, createMediaQuery } from '#utils/media';
import {
	calculatorSettingsEqual,
	DEFAULT_BANKROLL_CONFIG,
	DEFAULT_CONFIG,
	DEFAULT_PLAY_CONFIG,
	loadBankrollConfig,
	loadCalculatorConfig,
	loadPlayConfig,
	ruleSetFromConfig,
	saveBankrollConfig,
	saveCalculatorConfig,
	savePlayConfig,
	settingsFromConfig,
	type BankrollConfig,
	type CalculatorConfig,
	type CalculatorSettings,
	type PlayConfig,
} from '#utils/storage';
import type { PrecisionId } from '#utils/ev/precision';
import type {
	EvSummaryResult,
	EvWorkerRequest,
	EvWorkerResponse,
	EvWorkerResult,
	PlayGrids,
} from '#utils/evWorkerProtocol';

import { createGlobalKeydown, isKeyConsumingTarget } from '#utils/keyboard';
import { INPUT_SETTLE_MS } from '#utils/settle';

import AppHeader from '#c/AppHeader';
import BankrollOutput from '#c/BankrollOutput';
import type { CountEvProfile } from '#c/CountEvGraph';
import EvTable from '#c/EvTable';
import PlayView from '#c/PlayView';
import SettingsDrawer from '#c/SettingsDrawer';
import SettingsSidebar from '#c/SettingsSidebar';

import '#styles/App';

// Scaffolding for eyeballing the loading skeletons: the calculation finishes in
// well under a second, so add `?slowLoading=2000` (milliseconds) to the URL to
// hold the loading state open for at least that long. Dev builds only — the
// check compiles away in production, so the delay can never ship.
function artificialLoadingMs(): number {
	if (!import.meta.env.DEV) return 0;
	const raw = new URLSearchParams(window.location.search).get('slowLoading');
	const parsed = Number(raw);
	return raw !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * What the summary cards are read from: a result together with the config it was
 * computed from, since the bankroll figures need both.
 */
interface SummaryBasis {
	config: CalculatorConfig;
	result: EvSummaryResult;
}

const App: Component = () => {
	const initialConfig = loadCalculatorConfig() ?? DEFAULT_CONFIG;

	const [tab, setTab] = createHashRoute();

	const [result, setResult] = createSignal<EvWorkerResult | null>(null);
	const [isComputing, setIsComputing] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [calcTimeMs, setCalcTimeMs] = createSignal<number | null>(null);
	// The precision the figures on screen were actually priced at, which is what
	// the sidebar labels them with -- not the one the pending request asked for.
	const [resultPrecision, setResultPrecision] = createSignal<PrecisionId>('fast');
	// The precision of the request in flight, back to 'fast' once nothing is. A
	// signal rather than a plain `let` because it is the only thing that marks a
	// full run as busy on the Bankroll view, where a repriced-but-unchanged
	// summary drops neither of the computing flags.
	const [latestRequestPrecision, setLatestRequestPrecision] =
		createSignal<PrecisionId>('fast');
	// Held back from `result` on purpose. The summary cards describe the whole
	// shoe under the bet spread, not the hand in front of the player, so they
	// must not twitch every time the arrow keys move the count -- even though
	// the count does nudge the numbers they are derived from (the edge line is
	// fitted through the count's own shoe where it can be). So the basis is only
	// replaced when a *setting* changes, or when the same settings are repriced at
	// a different precision; a count-only recalculation leaves it, and the cards,
	// exactly where they were.
	const [summaryBasis, setSummaryBasis] = createSignal<SummaryBasis | null>(null);
	// Whether the pending calculation is one the summary cards are waiting on,
	// which is again a settings change or a reprice -- see above.
	const [isSummaryComputing, setIsSummaryComputing] = createSignal(false);
	// The true count lives here rather than in the sidebar form: it is the one
	// input a counter moves hand to hand, so the arrow keys drive it and it
	// recalculates on its own, without waiting for the settings to settle.
	const [trueCount, setTrueCount] = createSignal(initialConfig.trueCount);
	const [bankroll, setBankroll] = createSignal<BankrollConfig>(
		loadBankrollConfig() ?? DEFAULT_BANKROLL_CONFIG
	);

	const [play, setPlay] = createSignal<PlayConfig>(
		loadPlayConfig() ?? DEFAULT_PLAY_CONFIG
	);

	const updatePlay = <K extends keyof PlayConfig>(key: K, value: PlayConfig[K]) => {
		const next = { ...play(), [key]: value };
		setPlay(next);
		// Saved as typed, like the bankroll settings and for the same reason:
		// none of it reaches the worker, so there is nothing to recalculate.
		savePlayConfig(next);
	};

	/**
	 * The settings every dispatched calculation is running under. `latestRequestConfig`
	 * below holds the same thing, but as a plain `let` the Play view cannot follow it --
	 * and the felt has to re-deal when the rules move under it. Compared by value, so
	 * the count sweeping (or a play request re-dispatching the same settings) never
	 * looks like a change.
	 */
	const [liveSettings, setLiveSettings] = createSignal<CalculatorSettings>(
		settingsFromConfig(initialConfig),
		{ equals: calculatorSettingsEqual }
	);

	const playRuleSet = createMemo(() =>
		ruleSetFromConfig({ ...liveSettings(), trueCount: 0 })
	);

	/**
	 * The grids the Play view's coach grades against, and every count already
	 * priced this session. A shoe revisits the same handful of counts, so the
	 * cache means a count seen once never costs a second round trip.
	 */
	const [playGrids, setPlayGrids] = createSignal<PlayGrids | null>(null);
	const playGridCache = new Map<number, PlayGrids>();
	// What a cached entry belongs to: the grids are priced under the rules and
	// the tags as much as the count, so a settings change empties the cache.
	let playGridBasis = '';

	const updateBankroll = <K extends keyof BankrollConfig>(
		key: K,
		value: BankrollConfig[K]
	) => {
		const next = { ...bankroll(), [key]: value };
		setBankroll(next);
		// Saved as typed: these settings feed nothing the worker computes, so
		// there is no recalculation to hang the save off.
		saveBankrollConfig(next);
	};

	// Derived, not computed in the worker: every input is either already on the
	// result or a bankroll field, so a spread edit re-reads this instantly
	// instead of queueing another few seconds of enumeration. That is also what
	// keeps the bankroll tab off the grids entirely -- nothing here reaches the
	// worker, so the tables never even flicker.
	const bankrollAnalysis = createMemo<BankrollAnalysis | undefined>(() => {
		const basis = summaryBasis();
		if (!basis) return undefined;
		const config = basis.config;
		return analyzeBankroll(ruleSetFromConfig(config), config.tags, {
			...bankroll(),
			baseEvPercent: basis.result.average.baseEvPercent,
			edgeSlopePointsPerTrueCount: basis.result.edgeSlopePointsPerTrueCount,
			edgeCurvaturePointsPerTrueCountSquared:
				basis.result.edgeCurvaturePointsPerTrueCountSquared,
			variancePerRound: basis.result.average.variancePerRound,
		});
	});

	// Held in its own signal, rather than a plain memo, because it is the
	// expensive half of the graph card and the only half a bet spread cannot
	// change: 20,000 shuffled shoes, tens of milliseconds, settled entirely by
	// the counting system, the shoe size and the penetration. Editing the ramp
	// reprices the line below without dealing a single card again -- and,
	// since it is only ever read by the Bankroll view, it is only ever paid
	// for while that view is the one on screen. Editing Rules/Count while
	// parked on Tables leaves this signal alone; switching to Bankroll runs
	// the effect below once to catch up.
	const [roundFrequency, setRoundFrequency] = createSignal<RoundFrequency>();
	let roundFrequencySettings: CalculatorSettings | null = null;

	createEffect(() => {
		const config = summaryBasis()?.config;
		if (!config || tab() !== 'bankroll') return;
		const settings = settingsFromConfig(config);
		if (
			roundFrequencySettings
			&& calculatorSettingsEqual(settings, roundFrequencySettings)
		) {
			return;
		}
		roundFrequencySettings = settings;
		setRoundFrequency(simulateRoundFrequency(ruleSetFromConfig(config), config.tags));
	});

	// Read off the summary basis rather than the live config, so that the graph
	// changes in step with the cards beside it instead of jumping ahead of a
	// calculation they are still waiting on -- and so it holds still when the
	// count on screen moves, since it describes every count rather than one of
	// them. The bet spread and the unit are the exception: neither reaches any
	// calculation, so the line follows the ramp as it is edited and rescales with
	// the unit, exactly as the cards do.
	const countEv = createMemo<CountEvProfile | undefined>(() => {
		const basis = summaryBasis();
		const rounds = roundFrequency();
		if (!basis || !rounds) return undefined;
		const config = basis.config;
		const ruleSet = ruleSetFromConfig(config);
		return {
			rounds,
			ramp: bankroll().ramp,
			unit: bankroll().unit,
			countScale: hiLoCountScale(baseComposition(ruleSet), config.tags),
			edge: {
				baseEvPercent: basis.result.average.baseEvPercent,
				edgeSlopePointsPerTrueCount: basis.result.edgeSlopePointsPerTrueCount,
				edgeCurvaturePointsPerTrueCountSquared:
					basis.result.edgeCurvaturePointsPerTrueCountSquared,
			},
			decks: config.decks,
			penetrationPercent: config.penetrationPercent,
			systemLabel: labelForSystem(config.system),
		};
	});

	/**
	 * The settings the summary basis was built from. Held beside the signal
	 * rather than read back out of it, so that asking whether a calculation
	 * concerns the summary stays a plain question -- `runCalculation` is called
	 * from timers and from mount, where a reactive read would be ignored anyway.
	 */
	let summaryBasisSettings: CalculatorSettings | null = null;
	/**
	 * The precision those figures were priced at. Part of what the basis is, not
	 * just a label on it: every bankroll figure is derived from the average, so
	 * repricing the same settings at a different precision moves all of them --
	 * see docs/bankroll-model.md §Precision reaches every figure here.
	 */
	let summaryBasisPrecision: PrecisionId | null = null;

	/**
	 * Whether a calculation would leave the summary cards showing the figures they
	 * already show -- true when it differs from the basis by the true count alone
	 * (which `calculatorSettingsEqual` ignores by construction) *and* prices it the
	 * same way. Without the precision half, a full run -- which re-dispatches the
	 * settings unchanged on purpose -- would look like a count-only refresh and
	 * never reach the cards.
	 */
	const summaryBasisMatches = (
		config: CalculatorConfig,
		precision: PrecisionId
	): boolean =>
		summaryBasisSettings !== null
		&& summaryBasisPrecision === precision
		&& calculatorSettingsEqual(settingsFromConfig(config), summaryBasisSettings);

	// Exact enumeration over the full shoe takes seconds; offload it to a
	// worker so the main thread stays responsive and the grids can show a
	// loading state instead of freezing the tab.
	let worker: Worker | undefined;
	let latestRequestId = 0;
	let latestRequestStart = 0;
	let latestRequestConfig = initialConfig;
	// What the most recently dispatched (or, once it lands, applied) request
	// asked the worker for. 'summary' skips the full grid walk entirely, so a
	// settings edit made while Bankroll is on screen leaves `result` pointing
	// at whatever the grid last showed -- see the Tables catch-up effect below.
	let latestRequestScope: 'tables' | 'summary' | 'play' = 'tables';
	let holdTimer: number | undefined;

	const getWorker = (): Worker => {
		if (!worker) {
			worker = new Worker(new URL('./utils/blackjackEv.worker.ts', import.meta.url), {
				type: 'module',
			});
			// A single persistent handler, not one added per request: every
			// listener on a worker sees every message, so routing by comparing
			// each message's own requestId against the latest one is what keeps
			// a superseded request's (still in-flight) response from landing.
			worker.addEventListener('message', (event: MessageEvent<EvWorkerResponse>) => {
				if (event.data.requestId !== latestRequestId) return;
				const response = event.data;
				// Measured here rather than in `apply` so the reported time stays the
				// real compute time, unpadded by any artificial hold.
				const elapsed = performance.now() - latestRequestStart;

				const apply = () => {
					// Re-checked because a newer request can be dispatched during the
					// hold, and this response must not overwrite it.
					if (response.requestId !== latestRequestId) return;
					// Ahead of everything below: the Play grids are neither a result
					// the tables read nor a basis the summary cards are built from,
					// and a play request never marked anything as computing.
					if (response.status === 'success' && response.scope === 'play') {
						playGridCache.set(latestRequestConfig.trueCount, response.result);
						setPlayGrids(response.result);
						return;
					}
					setIsComputing(false);
					setIsSummaryComputing(false);
					setLatestRequestPrecision('fast');
					if (response.status === 'success') {
						const config = latestRequestConfig;
						setCalcTimeMs(elapsed);
						setResultPrecision(response.precision);
						// A 'summary' response has no grids to apply -- the Tables view
						// picks up the settings it was computed from when it next asks
						// for them, via the catch-up effect below.
						if (response.scope === 'tables') setResult(response.result);
						// Only a settings change, or a reprice at a different precision,
						// refreshes what the summary reads; a count-only result at the
						// same precision is applied to the grids alone.
						if (!summaryBasisMatches(config, response.precision)) {
							summaryBasisSettings = settingsFromConfig(config);
							summaryBasisPrecision = response.precision;
							setSummaryBasis({ config, result: response.result });
						}
					} else {
						setCalcTimeMs(null);
						setError(response.message);
					}
				};

				const hold = artificialLoadingMs() - elapsed;
				if (hold > 0) {
					holdTimer = window.setTimeout(apply, hold);
				} else {
					apply();
				}
			});
		}
		return worker;
	};

	onCleanup(() => {
		clearTimeout(holdTimer);
		clearTimeout(countTimer);
		worker?.terminate();
	});

	const runCalculation = (
		nextConfig: CalculatorConfig,
		scope: 'tables' | 'summary' | 'play',
		// Defaulted rather than passed by each caller, which is what makes the full
		// calculation a one-shot: the next settings edit, count step or Tables
		// catch-up goes back to fast without having to be told to.
		precision: PrecisionId = 'fast'
	) => {
		const w = getWorker();
		clearTimeout(holdTimer);
		latestRequestId += 1;
		latestRequestStart = performance.now();
		latestRequestConfig = nextConfig;
		latestRequestScope = scope;
		setLiveSettings(settingsFromConfig(nextConfig));
		setLatestRequestPrecision(precision);
		// Note that `result` is deliberately left alone here: the previous rows
		// stay in place while the new ones are computed. EvCell keeps each cell's
		// popover mounted for as long as it has row data, and that is what stops
		// a Portal per cell being torn down and rebuilt mid-recalculation, which
		// would kill the background transition out of the loading state. Clearing
		// it here would break that animation from a distance.
		if (scope === 'tables') setIsComputing(true);
		// A count-only recalculation is not something the cards are waiting for:
		// they keep their figures rather than dropping to skeletons. A full run is,
		// since it is going to move every one of them. A play request is neither --
		// it computes nothing either the grids or the cards are showing.
		if (scope !== 'play' && !summaryBasisMatches(nextConfig, precision)) {
			setIsSummaryComputing(true);
		}
		setError(null);
		// Saved here rather than in the form, since the count reaches a
		// calculation without passing through it at all. Not for a play request:
		// its count is the felt's shoe, not the count the user left the grids on.
		if (scope !== 'play') saveCalculatorConfig(nextConfig);

		const request: EvWorkerRequest = {
			requestId: latestRequestId,
			scope,
			precision,
			ruleSet: ruleSetFromConfig(nextConfig),
			trueCount: nextConfig.trueCount,
			tags: nextConfig.tags,
		};
		w.postMessage(request);
	};

	// The count settles on the same delay as the settings, for the same reason:
	// the arrow keys repeat far faster than the worker answers, so the reading
	// moves on screen at once while one sweep from +2 to +10 costs a single
	// enumeration rather than eight.
	let countTimer: number | undefined;

	const stepCount = (step: number) => {
		const next = trueCount() + step;
		setTrueCount(next);
		clearTimeout(countTimer);
		countTimer = window.setTimeout(() => {
			// A sweep that ends where it started -- an arrow key overshot and
			// corrected -- has nothing to compute: the count already being
			// calculated is this one, so the queued run is dropped rather than
			// reissuing the request that is producing the grids on screen.
			// Checked here rather than as the keys are pressed, so that it also
			// catches a settings change that got there first at this same count.
			if (next === latestRequestConfig.trueCount) return;
			// Based on the newest requested config rather than the applied one, so
			// a count change during a recalculation keeps the rules being computed.
			runCalculation({ ...latestRequestConfig, trueCount: next }, 'tables');
		}, INPUT_SETTLE_MS);
	};

	createGlobalKeydown((event) => {
		const step =
			event.key === 'ArrowUp' ? 1
			: event.key === 'ArrowDown' ? -1
			: 0;
		// Stepping the count only matters to the grid display, so it is
		// ignored outside the Tables view -- there is nothing on the Bankroll
		// view for it to update.
		if (step === 0 || isKeyConsumingTarget(event.target) || tab() !== 'tables') return;
		// Both keys scroll the page by default, which would drag the grids out
		// from under the change the key just made.
		event.preventDefault();
		stepCount(step);
	});

	// Seeded on mount at whatever scope the starting tab needs -- the full grid
	// for Tables, or just the aggregate figures for Bankroll -- so only the
	// view actually on screen pays for its half of the first calculation.
	runCalculation(initialConfig, tab() === 'tables' ? 'tables' : 'summary');

	const requestCalculation = (settings: CalculatorSettings) => {
		// Whichever view is on screen is the one a settings edit has to reach;
		// the other is left stale until the user navigates to it -- see the
		// catch-up effect below, which is the Tables half of that.
		runCalculation(
			{ ...settings, trueCount: trueCount() },
			tab() === 'tables' ? 'tables' : 'summary'
		);
	};

	/**
	 * Reprices what is on screen at full precision, at whichever view's scope is
	 * showing. Deliberate and one-shot: nothing else in the app ever asks for
	 * 'full', so the next recalculation of any kind drops back to 'fast'.
	 */
	const runFullCalculation = () => {
		runCalculation(
			{ ...latestRequestConfig, trueCount: trueCount() },
			tab() === 'tables' ? 'tables' : 'summary',
			'full'
		);
	};

	/**
	 * Prices the grids the Play view's coach needs at `count`, unless a cache
	 * entry already answers it. The felt asks on every transition, so this is
	 * called far more often than it dispatches anything.
	 */
	const requestPlayGrids = (count: number) => {
		// The settings alone: the count is what the cache is keyed by, so it is
		// the one field that must not invalidate it.
		const basis = JSON.stringify(liveSettings());
		if (basis !== playGridBasis) {
			playGridCache.clear();
			playGridBasis = basis;
		}
		const cached = playGridCache.get(count);
		if (cached) {
			setPlayGrids(cached);
			return;
		}
		runCalculation({ ...latestRequestConfig, trueCount: count }, 'play');
	};

	// A settings edit made while parked on Bankroll only refreshes the summary
	// figures (`requestCalculation` above asks for nothing more), so the
	// Tables grid can be left showing stale settings. Caught up here, once,
	// whenever the user switches back to it.
	createEffect(() => {
		if (tab() !== 'tables' || latestRequestScope === 'tables') return;
		runCalculation({ ...latestRequestConfig, trueCount: trueCount() }, 'tables');
	});

	// Whether the settings belong in a drawer rather than a column beside the
	// content -- on a phone in either orientation, where there is neither the
	// width for a sidebar nor the height to scroll past one.
	const compact = createMediaQuery(COMPACT_LAYOUT_QUERY);
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	// A viewport that grows past the breakpoint puts the sidebar back in the
	// page, so the drawer's open flag has to be dropped with it -- otherwise
	// coming back down to a phone width reopens it unasked.
	createEffect(() => {
		if (!compact()) setSettingsOpen(false);
	});

	/**
	 * One sidebar, mounted in one of two places. Switching between them remounts
	 * it, which re-seeds the form -- hence the live settings rather than the
	 * load-time config, so the fields come back showing what is actually being
	 * calculated. See `SettingsSidebarProps.config`.
	 */
	const sidebar = () => (
		<SettingsSidebar
			config={{ ...liveSettings(), trueCount: trueCount() }}
			calcTimeMs={calcTimeMs()}
			onSettingsChange={requestCalculation}
			// Play always grades at 'fast': the felt asks for a new count every
			// few cards, and a seconds-long run has nothing to offer it.
			onFullCalculation={tab() === 'play' ? undefined : runFullCalculation}
			isFullResult={resultPrecision() === 'full'}
			isBusy={
				isComputing() || isSummaryComputing() || latestRequestPrecision() === 'full'
			}
			bankroll={bankroll()}
			bankrollAnalysis={bankrollAnalysis()}
			onBankrollChange={updateBankroll}
			play={play()}
			onPlayChange={updatePlay}
		/>
	);

	return (
		<>
			<AppHeader
				tab={tab()}
				onTabChange={setTab}
				onOpenSettings={compact() ? () => setSettingsOpen(true) : undefined}
			/>
			<Show when={compact()}>
				<SettingsDrawer open={settingsOpen()} onOpenChange={setSettingsOpen}>
					{sidebar()}
				</SettingsDrawer>
			</Show>
			<main class="app">
				<div class="app__layout">
					<Show when={!compact()}>{sidebar()}</Show>
					<Show when={tab() === 'tables'}>
						<EvTable
							result={result}
							isComputing={isComputing}
							error={error}
							trueCount={trueCount}
							onStepCount={stepCount}
						/>
					</Show>
					<Show when={tab() === 'bankroll'}>
						<BankrollOutput
							error={error}
							isSummaryComputing={isSummaryComputing}
							bankroll={bankrollAnalysis}
							countEv={countEv}
						/>
					</Show>
					<Show when={tab() === 'play'}>
						<PlayView
							ruleSet={playRuleSet()}
							tags={liveSettings().tags}
							config={play()}
							bankroll={bankroll().bankroll}
							unit={bankroll().unit}
							grids={playGrids()}
							onCountChange={requestPlayGrids}
						/>
					</Show>
				</div>
			</main>
		</>
	);
};

export default App;
