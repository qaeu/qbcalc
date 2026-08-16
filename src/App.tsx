import { createMemo, createSignal, onCleanup, type Component } from 'solid-js';

import { analyzeBankroll, type BankrollAnalysis } from '#utils/bankroll';
import {
	calculatorSettingsEqual,
	DEFAULT_BANKROLL_CONFIG,
	DEFAULT_CONFIG,
	loadBankrollConfig,
	loadCalculatorConfig,
	ruleSetFromConfig,
	saveBankrollConfig,
	saveCalculatorConfig,
	settingsFromConfig,
	type BankrollConfig,
	type CalculatorConfig,
	type CalculatorSettings,
} from '#utils/storage';
import type {
	EvWorkerRequest,
	EvWorkerResponse,
	EvWorkerResult,
} from '#utils/evWorkerProtocol';

import { createGlobalKeydown, isKeyConsumingTarget } from '#utils/keyboard';
import { INPUT_SETTLE_MS } from '#utils/settle';

import EvTable from '#c/EvTable';
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
	result: EvWorkerResult;
}

const App: Component = () => {
	const initialConfig = loadCalculatorConfig() ?? DEFAULT_CONFIG;

	const [result, setResult] = createSignal<EvWorkerResult | null>(null);
	const [isComputing, setIsComputing] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [calcTimeMs, setCalcTimeMs] = createSignal<number | null>(null);
	// Held back from `result` on purpose. The summary cards describe the whole
	// shoe under the bet spread, not the hand in front of the player, so they
	// must not twitch every time the arrow keys move the count -- even though
	// the count does nudge the numbers they are derived from (the edge line is
	// fitted through the count's own shoe where it can be). So the basis is only
	// replaced when a *setting* changes; a count-only recalculation leaves it,
	// and the cards, exactly where they were.
	const [summaryBasis, setSummaryBasis] = createSignal<SummaryBasis | null>(null);
	// Whether the pending calculation is one the summary cards are waiting on,
	// which is again settings changes only -- see above.
	const [isSummaryComputing, setIsSummaryComputing] = createSignal(false);
	// The true count lives here rather than in the sidebar form: it is the one
	// input a counter moves hand to hand, so the arrow keys drive it and it
	// recalculates on its own, without waiting for the settings to settle.
	const [trueCount, setTrueCount] = createSignal(initialConfig.trueCount);
	const [bankroll, setBankroll] = createSignal<BankrollConfig>(
		loadBankrollConfig() ?? DEFAULT_BANKROLL_CONFIG
	);

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
			variancePerRound: basis.result.average.variancePerRound,
		});
	});

	/**
	 * The settings the summary basis was built from. Held beside the signal
	 * rather than read back out of it, so that asking whether a calculation
	 * concerns the summary stays a plain question -- `runCalculation` is called
	 * from timers and from mount, where a reactive read would be ignored anyway.
	 */
	let summaryBasisSettings: CalculatorSettings | null = null;

	/**
	 * Whether a config would leave the summary cards showing the figures they
	 * already show -- true when it differs from the basis by the true count
	 * alone, which `calculatorSettingsEqual` ignores by construction.
	 */
	const summaryBasisMatches = (config: CalculatorConfig): boolean =>
		summaryBasisSettings !== null
		&& calculatorSettingsEqual(settingsFromConfig(config), summaryBasisSettings);

	// Exact enumeration over the full shoe takes seconds; offload it to a
	// worker so the main thread stays responsive and the grids can show a
	// loading state instead of freezing the tab.
	let worker: Worker | undefined;
	let latestRequestId = 0;
	let latestRequestStart = 0;
	let latestRequestConfig = initialConfig;
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
					setIsComputing(false);
					setIsSummaryComputing(false);
					if (response.status === 'success') {
						const config = latestRequestConfig;
						setCalcTimeMs(elapsed);
						setResult(response.result);
						// Only a settings change refreshes what the summary reads;
						// a count-only result is applied to the grids alone.
						if (!summaryBasisMatches(config)) {
							summaryBasisSettings = settingsFromConfig(config);
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

	const runCalculation = (nextConfig: CalculatorConfig) => {
		const w = getWorker();
		clearTimeout(holdTimer);
		latestRequestId += 1;
		latestRequestStart = performance.now();
		latestRequestConfig = nextConfig;
		// Note that `result` is deliberately left alone here: the previous rows
		// stay in place while the new ones are computed. EvCell keeps each cell's
		// popover mounted for as long as it has row data, and that is what stops
		// a Portal per cell being torn down and rebuilt mid-recalculation, which
		// would kill the background transition out of the loading state. Clearing
		// it here would break that animation from a distance.
		setIsComputing(true);
		// A count-only recalculation is not something the cards are waiting for:
		// they keep their figures rather than dropping to skeletons.
		if (!summaryBasisMatches(nextConfig)) setIsSummaryComputing(true);
		setError(null);
		// Saved here rather than in the form, since the count reaches a
		// calculation without passing through it at all.
		saveCalculatorConfig(nextConfig);

		const request: EvWorkerRequest = {
			requestId: latestRequestId,
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
			runCalculation({ ...latestRequestConfig, trueCount: next });
		}, INPUT_SETTLE_MS);
	};

	createGlobalKeydown((event) => {
		const step =
			event.key === 'ArrowUp' ? 1
			: event.key === 'ArrowDown' ? -1
			: 0;
		if (step === 0 || isKeyConsumingTarget(event.target)) return;
		// Both keys scroll the page by default, which would drag the grids out
		// from under the change the key just made.
		event.preventDefault();
		stepCount(step);
	});

	runCalculation(initialConfig);

	return (
		<main class="app">
			<h1>Blackjack EV Calculator</h1>
			<div class="app__layout">
				<SettingsSidebar
					initialConfig={initialConfig}
					calcTimeMs={calcTimeMs()}
					onSettingsChange={(settings: CalculatorSettings) =>
						runCalculation({ ...settings, trueCount: trueCount() })
					}
					bankroll={bankroll()}
					bankrollAnalysis={bankrollAnalysis()}
					onBankrollChange={updateBankroll}
				/>
				<EvTable
					result={result}
					isComputing={isComputing}
					isSummaryComputing={isSummaryComputing}
					error={error}
					trueCount={trueCount}
					bankroll={bankrollAnalysis}
				/>
			</div>
		</main>
	);
};

export default App;
