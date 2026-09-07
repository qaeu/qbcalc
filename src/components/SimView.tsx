/**
 * The Sim view: a session dealt under the sidebar's own game, off the sim
 * worker, and reported against what the Bankroll view predicted for it.
 * Everything stateful about a run lives here -- the worker's lifetime, the
 * progress and the last result -- and the four components below are handed what
 * to draw. See docs/sim-model.md.
 */

import { createSignal, onCleanup, Show, type Component } from 'solid-js';

import type { BankrollAnalysis } from '#utils/bankroll';
import type { CountingSystemId } from '#utils/countingSystems';
import type { TagValues } from '#utils/ev/composition';
import type { PrecisionId } from '#utils/ev/precision';
import type { RuleSet } from '#utils/ev/rules';
import { formatDuration } from '#utils/format';
import type { SimConfig } from '#utils/sim/config';
import type { SimResult } from '#utils/sim/result';
import type { SimWorkerRequest, SimWorkerResponse } from '#utils/simWorkerProtocol';
import type { BankrollConfig } from '#utils/storage';

import SimConfigPanel, { type SimProgress } from '#c/SimConfigPanel';
import SimCountTable from '#c/SimCountTable';
import SimSetup from '#c/SimSetup';
import SimStats from '#c/SimStats';
import SimTrajectory from '#c/SimTrajectory';

import '#styles/SimView';

interface SimViewProps {
	ruleSet: RuleSet;
	tags: TagValues;
	system: CountingSystemId;
	config: SimConfig;
	onConfigChange: <K extends keyof SimConfig>(key: K, value: SimConfig[K]) => void;
	bankroll: BankrollConfig;
	/** What the Bankroll view predicts for the same game, where there is a result yet. */
	predicted: BankrollAnalysis | undefined;
	/**
	 * The precision the figures on screen were last priced at, which a run adopts:
	 * a session dealt off full-precision grids is the one comparable with a
	 * full-precision predicted column. Back to 'fast' as soon as anything else
	 * recalculates, so it costs nothing unless the button was the last thing
	 * pressed. See docs/sim-model.md §Pricing the counts.
	 */
	precision: PrecisionId;
}

const SimView: Component<SimViewProps> = (props) => {
	const [running, setRunning] = createSignal(false);
	const [progress, setProgress] = createSignal<SimProgress | undefined>();
	const [result, setResult] = createSignal<SimResult | undefined>();
	const [elapsedMs, setElapsedMs] = createSignal<number | null>(null);
	const [error, setError] = createSignal<string | null>(null);

	// Created on the first run rather than on mount: a user who never runs a sim
	// never pays for a second thread, and the module the worker imports pulls the
	// whole EV engine in behind it.
	let worker: Worker | undefined;
	let latestRequestId = 0;

	const getWorker = (): Worker => {
		if (!worker) {
			worker = new Worker(new URL('../utils/sim.worker.ts', import.meta.url), {
				type: 'module',
			});
			worker.addEventListener('message', (event: MessageEvent<SimWorkerResponse>) => {
				const response = event.data;
				// A response for a superseded run: the same "latest request wins"
				// rule the EV worker keeps, since every listener sees every message.
				if (response.requestId !== latestRequestId) return;
				switch (response.type) {
					case 'progress':
						setProgress({
							phase: response.phase,
							roundsDealt: response.roundsDealt,
							rounds: response.rounds,
						});
						break;
					case 'complete':
						setRunning(false);
						setProgress(undefined);
						setElapsedMs(response.elapsedMs);
						setResult(response.result);
						break;
					case 'cancelled':
						setRunning(false);
						setProgress(undefined);
						break;
					case 'error':
						setRunning(false);
						setProgress(undefined);
						setError(response.message);
						break;
				}
			});
		}
		return worker;
	};

	onCleanup(() => worker?.terminate());

	const run = () => {
		const w = getWorker();
		latestRequestId += 1;
		// Drawn here rather than in the worker, and written back into the form, so
		// that the seed on screen is always the one that dealt the result beside it
		// -- which is what makes a run repeatable with re-seeding switched off.
		const seed =
			props.config.reseedEachRun ?
				Math.floor(Math.random() * 0xffffffff)
			:	props.config.seed;
		if (seed !== props.config.seed) props.onConfigChange('seed', seed);

		setRunning(true);
		setError(null);
		setElapsedMs(null);
		setProgress({ phase: 'pricing', roundsDealt: 0, rounds: props.config.rounds });

		const request: SimWorkerRequest = {
			requestId: latestRequestId,
			ruleSet: props.ruleSet,
			tags: props.tags,
			sim: { ...props.config, seed },
			ramp: props.bankroll.ramp,
			unit: props.bankroll.unit,
			roundsPerHour: props.bankroll.roundsPerHour,
			// Whatever the figures beside the run were last priced at. A run visits
			// perhaps twenty counts, so full precision costs a second or two of
			// pricing and nothing per round after it.
			precision: props.precision,
		};
		w.postMessage(request);
	};

	const cancel = () => {
		worker?.postMessage({ type: 'cancel', requestId: latestRequestId });
	};

	return (
		<section class="sim-view">
			<SimSetup
				ruleSet={props.ruleSet}
				system={props.system}
				bankroll={props.bankroll}
				precision={props.precision}
			/>
			<SimConfigPanel
				config={props.config}
				onChange={props.onConfigChange}
				running={running()}
				progress={progress()}
				onRun={run}
				onCancel={cancel}
			/>
			<Show when={error()}>
				{(message) => <p class="sim-view__error">{message()}</p>}
			</Show>
			<SimStats result={result()} predicted={props.predicted} />
			<Show when={elapsedMs()}>
				{(ms) => <p class="sim-view__timing">Dealt in {formatDuration(ms())}</p>}
			</Show>
			<Show when={result()}>
				{(finished) => (
					<>
						<SimTrajectory samples={finished().samples} />
						<SimCountTable buckets={finished().buckets} />
					</>
				)}
			</Show>
		</section>
	);
};

export default SimView;
