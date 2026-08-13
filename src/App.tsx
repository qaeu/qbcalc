import { createSignal, onCleanup, type Component } from 'solid-js';

import {
	DEFAULT_CONFIG,
	loadCalculatorConfig,
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

const App: Component = () => {
	const initialConfig = loadCalculatorConfig() ?? DEFAULT_CONFIG;

	const [result, setResult] = createSignal<EvWorkerResult | null>(null);
	const [isComputing, setIsComputing] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [calcTimeMs, setCalcTimeMs] = createSignal<number | null>(null);

	// Exact enumeration over the full shoe takes seconds; offload it to a
	// worker so the main thread stays responsive and the grids can show a
	// loading state instead of freezing the tab.
	let worker: Worker | undefined;
	let latestRequestId = 0;
	let latestRequestStart = 0;

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
				setIsComputing(false);
				if (event.data.status === 'success') {
					setCalcTimeMs(performance.now() - latestRequestStart);
					setResult(event.data.result);
				} else {
					setCalcTimeMs(null);
					setError(event.data.message);
				}
			});
		}
		return worker;
	};

	onCleanup(() => worker?.terminate());

	const runCalculation = (nextConfig: CalculatorConfig) => {
		const w = getWorker();
		latestRequestId += 1;
		latestRequestStart = performance.now();
		setIsComputing(true);
		setError(null);

		const { decks, count, dealerHitsSoft17, tags } = nextConfig;
		const request: EvWorkerRequest = {
			requestId: latestRequestId,
			ruleSet: { decks, dealerHitsSoft17 },
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
				<EvTable result={result} isComputing={isComputing} error={error} />
			</div>
		</main>
	);
};

export default App;
