import { createSignal, onCleanup, type Component } from 'solid-js';

import {
	DEFAULT_CONFIG,
	loadCalculatorConfig,
	ruleSetFromConfig,
	type CalculatorConfig,
} from '#utils/storage';
import type {
	EvWorkerRequest,
	EvWorkerResponse,
	EvWorkerResult,
} from '#utils/evWorkerProtocol';

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
	const [appliedCount, setAppliedCount] = createSignal(initialConfig.count);

	// Exact enumeration over the full shoe takes seconds; offload it to a
	// worker so the main thread stays responsive and the grids can show a
	// loading state instead of freezing the tab.
	let worker: Worker | undefined;
	let latestRequestId = 0;
	let latestRequestStart = 0;
	let latestRequestCount = 0;
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
						setAppliedCount(latestRequestCount);
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
		worker?.terminate();
	});

	const runCalculation = (nextConfig: CalculatorConfig) => {
		const w = getWorker();
		clearTimeout(holdTimer);
		latestRequestId += 1;
		latestRequestStart = performance.now();
		latestRequestCount = nextConfig.count;
		// Note that `result` is deliberately left alone here: the previous rows
		// stay in place while the new ones are computed. EvCell keeps each cell's
		// popover mounted for as long as it has row data, and that is what stops
		// a Portal per cell being torn down and rebuilt mid-recalculation, which
		// would kill the background transition out of the loading state. Clearing
		// it here would break that animation from a distance.
		setIsComputing(true);
		setError(null);

		const { count, tags } = nextConfig;
		const request: EvWorkerRequest = {
			requestId: latestRequestId,
			ruleSet: ruleSetFromConfig(nextConfig),
			count,
			tags,
		};
		w.postMessage(request);
	};

	runCalculation(initialConfig);

	return (
		<main class="app">
			<h1>Blackjack EV Calculator</h1>
			<div class="app__layout">
				<SettingsSidebar
					initialConfig={initialConfig}
					calcTimeMs={calcTimeMs()}
					onSubmit={runCalculation}
				/>
				<EvTable
					result={result}
					isComputing={isComputing}
					error={error}
					count={appliedCount}
				/>
			</div>
		</main>
	);
};

export default App;
