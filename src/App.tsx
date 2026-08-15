import { createMemo, createSignal, onCleanup, type Component } from 'solid-js';

import { analyzeBankroll, type BankrollAnalysis } from '#utils/bankroll';
import {
	DEFAULT_BANKROLL_CONFIG,
	DEFAULT_CONFIG,
	loadBankrollConfig,
	loadCalculatorConfig,
	ruleSetFromConfig,
	saveBankrollConfig,
	saveCalculatorConfig,
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

const App: Component = () => {
	const initialConfig = loadCalculatorConfig() ?? DEFAULT_CONFIG;

	const [result, setResult] = createSignal<EvWorkerResult | null>(null);
	const [isComputing, setIsComputing] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [calcTimeMs, setCalcTimeMs] = createSignal<number | null>(null);
	// The config the shown result was computed from, which is what the bankroll
	// figures have to be read against -- the sidebar's own config may already
	// have moved on to something not yet calculated.
	const [appliedConfig, setAppliedConfig] = createSignal(initialConfig);
	// The running count lives here rather than in the sidebar form: it is the
	// one input a counter moves hand to hand, so the arrow keys drive it and it
	// recalculates on its own instead of waiting on Calculate.
	const [count, setCount] = createSignal(initialConfig.count);
	const [bankroll, setBankroll] = createSignal<BankrollConfig>(
		loadBankrollConfig() ?? DEFAULT_BANKROLL_CONFIG
	);

	const updateBankroll = <K extends keyof BankrollConfig>(
		key: K,
		value: BankrollConfig[K]
	) => {
		const next = { ...bankroll(), [key]: value };
		setBankroll(next);
		// Saved as typed rather than on a submit: these settings have no
		// Calculate step to hang the save off, since nothing recomputes.
		saveBankrollConfig(next);
	};

	// Derived, not computed in the worker: every input is either already on the
	// result or a bankroll field, so a spread edit re-reads this instantly
	// instead of queueing another few seconds of enumeration.
	const bankrollAnalysis = createMemo<BankrollAnalysis | undefined>(() => {
		const current = result();
		if (!current) return undefined;
		const config = appliedConfig();
		return analyzeBankroll(ruleSetFromConfig(config), config.tags, {
			...bankroll(),
			baseEvPercent: current.average.baseEvPercent,
			edgeSlopePointsPerTrueCount: current.edgeSlopePointsPerTrueCount,
			variancePerRound: current.average.variancePerRound,
		});
	});

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
					if (response.status === 'success') {
						setCalcTimeMs(elapsed);
						setResult(response.result);
						setAppliedConfig(latestRequestConfig);
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
		setError(null);
		// Saved here rather than on submit, since the count reaches a calculation
		// without passing through the form at all.
		saveCalculatorConfig(nextConfig);

		const request: EvWorkerRequest = {
			requestId: latestRequestId,
			ruleSet: ruleSetFromConfig(nextConfig),
			count: nextConfig.count,
			tags: nextConfig.tags,
		};
		w.postMessage(request);
	};

	/**
	 * How long the count waits for the arrow keys to settle before a
	 * calculation is queued. A held key repeats far faster than the worker
	 * answers, so the count moves on screen at once and one sweep from +2 to
	 * +10 costs a single enumeration rather than eight.
	 */
	const COUNT_SETTLE_MS = 120;
	let countTimer: number | undefined;

	const stepCount = (step: number) => {
		const next = count() + step;
		setCount(next);
		clearTimeout(countTimer);
		countTimer = window.setTimeout(
			// Based on the newest requested config rather than the applied one, so
			// a count change during a recalculation keeps the rules being computed.
			() => runCalculation({ ...latestRequestConfig, count: next }),
			COUNT_SETTLE_MS
		);
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
					onSubmit={(settings: CalculatorSettings) =>
						runCalculation({ ...settings, count: count() })
					}
					bankroll={bankroll()}
					bankrollAnalysis={bankrollAnalysis()}
					onBankrollChange={updateBankroll}
				/>
				<EvTable
					result={result}
					isComputing={isComputing}
					error={error}
					count={count}
					bankroll={bankrollAnalysis}
				/>
			</div>
		</main>
	);
};

export default App;
