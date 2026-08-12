import { HoverCard } from '@ark-ui/solid/hover-card';
import { createMemo, createSignal, For, onCleanup, Show, type Component } from 'solid-js';

import {
	DEFAULT_RULE_SET,
	HARD_TOTALS,
	PAIR_RANKS,
	RANKS,
	SOFT_TOTALS,
	type EvCellData,
	type PlayerAction,
	type Rank,
} from '#utils/blackjackEv';
import { formatDuration, formatPairLabel, formatSoftTotalLabel } from '#utils/format';
import { loadCalculatorConfig, saveCalculatorConfig } from '#utils/storage';
import type {
	EvWorkerRequest,
	EvWorkerResponse,
	EvWorkerResult,
} from '#utils/evWorkerProtocol';

import EvCellPopover from '#c/EvCellPopover';

import '#styles/EvTable';

interface CalculatorParams {
	decks: number;
	count: number;
	dealerHitsSoft17: boolean;
}

type ComparisonBundle = EvWorkerResult;

const DEFAULT_PARAMS: CalculatorParams = {
	decks: DEFAULT_RULE_SET.decks,
	count: 1,
	dealerHitsSoft17: DEFAULT_RULE_SET.dealerHitsSoft17,
};

function cellKey(rowId: number | Rank, upcard: Rank): string {
	return `${rowId}-${upcard}`;
}

interface EvCellProps {
	row: EvCellData;
}

const ACTION_CLASS: Record<PlayerAction, string> = {
	H: 'is-hit',
	S: 'is-stand',
	D: 'is-double',
	P: 'is-split',
};

const EvCell: Component<EvCellProps> = (props) => {
	return (
		<HoverCard.Root openDelay={0} closeDelay={0} positioning={{ placement: 'bottom' }}>
			<HoverCard.Trigger
				asChild={(triggerProps) => (
					<td
						{...triggerProps()}
						tabIndex={0}
						class={ACTION_CLASS[props.row.optimalAction]}
					>
						{props.row.optimalAction}
					</td>
				)}
			/>
			<EvCellPopover row={props.row} />
		</HoverCard.Root>
	);
};

const LoadingCell: Component = () => (
	<td class="is-loading">
		<span class="ev-table__cell-skeleton" aria-hidden="true" />
	</td>
);

interface EvGridProps {
	title: string;
	rowHeading: string;
	totals: readonly number[];
	upcards: readonly Rank[];
	rowsByKey: Map<string, EvCellData>;
	loading: boolean;
	rowLabel?: (total: number) => string;
}

const EvGrid: Component<EvGridProps> = (props) => (
	<div class="ev-table__grid">
		<h3>{props.title}</h3>
		<div class="ev-table__grid-scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">{props.rowHeading}</th>
						<For each={props.upcards}>{(upcard) => <th scope="col">{upcard}</th>}</For>
					</tr>
				</thead>
				<tbody>
					<For each={props.totals}>
						{(total) => (
							<tr>
								<th scope="row">{props.rowLabel ? props.rowLabel(total) : total}</th>
								<For each={props.upcards}>
									{(upcard) => (
										<Show when={!props.loading} fallback={<LoadingCell />}>
											<Show
												when={props.rowsByKey.get(cellKey(total, upcard))}
												fallback={<td>—</td>}
											>
												{(row) => <EvCell row={row()} />}
											</Show>
										</Show>
									)}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	</div>
);

interface SplitEvGridProps {
	title: string;
	pairRanks: readonly Rank[];
	upcards: readonly Rank[];
	rowsByKey: Map<string, EvCellData>;
	loading: boolean;
}

const SplitEvGrid: Component<SplitEvGridProps> = (props) => (
	<div class="ev-table__grid">
		<h3>{props.title}</h3>
		<div class="ev-table__grid-scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Pair</th>
						<For each={props.upcards}>{(upcard) => <th scope="col">{upcard}</th>}</For>
					</tr>
				</thead>
				<tbody>
					<For each={props.pairRanks}>
						{(pairRank) => (
							<tr>
								<th scope="row">{formatPairLabel(pairRank)}</th>
								<For each={props.upcards}>
									{(upcard) => (
										<Show when={!props.loading} fallback={<LoadingCell />}>
											<Show
												when={props.rowsByKey.get(cellKey(pairRank, upcard))}
												fallback={<td>—</td>}
											>
												{(row) => <EvCell row={row()} />}
											</Show>
										</Show>
									)}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	</div>
);

const EvTable: Component = () => {
	const initialParams = loadCalculatorConfig() ?? DEFAULT_PARAMS;

	const [decksInput, setDecksInput] = createSignal(initialParams.decks);
	const [countInput, setCountInput] = createSignal(initialParams.count);
	const [standsSoft17Input, setStandsSoft17Input] = createSignal(
		!initialParams.dealerHitsSoft17
	);
	const [result, setResult] = createSignal<ComparisonBundle | null>(null);
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
			worker = new Worker(new URL('../utils/blackjackEv.worker.ts', import.meta.url), {
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

	const runCalculation = (nextParams: CalculatorParams) => {
		const w = getWorker();
		latestRequestId += 1;
		latestRequestStart = performance.now();
		setIsComputing(true);
		setError(null);

		const { decks, count, dealerHitsSoft17 } = nextParams;
		const request: EvWorkerRequest = {
			requestId: latestRequestId,
			ruleSet: { decks, dealerHitsSoft17 },
			count,
		};
		w.postMessage(request);
	};

	runCalculation(initialParams);

	const hardRowsByKey = createMemo(() => {
		const map = new Map<string, EvCellData>();
		for (const row of result()?.hard.rows ?? []) {
			map.set(cellKey(row.total, row.upcard), row);
		}
		return map;
	});

	const softRowsByKey = createMemo(() => {
		const map = new Map<string, EvCellData>();
		for (const row of result()?.soft.rows ?? []) {
			map.set(cellKey(row.total, row.upcard), row);
		}
		return map;
	});

	const splitRowsByKey = createMemo(() => {
		const map = new Map<string, EvCellData>();
		for (const row of result()?.split.rows ?? []) {
			map.set(cellKey(row.pairRank, row.upcard), row);
		}
		return map;
	});

	const handleSubmit = (event: SubmitEvent) => {
		event.preventDefault();
		const nextParams: CalculatorParams = {
			decks: decksInput(),
			count: countInput(),
			dealerHitsSoft17: !standsSoft17Input(),
		};
		saveCalculatorConfig(nextParams);
		runCalculation(nextParams);
	};

	return (
		<section class="ev-table">
			<div class="ev-table__header">
				<h2>Ace-Five Count EV Table</h2>
				<form class="ev-table__controls" onSubmit={handleSubmit}>
					<label>
						Decks
						<input
							type="number"
							min="1"
							max="8"
							value={decksInput()}
							onInput={(event) => setDecksInput(Number(event.currentTarget.value))}
						/>
					</label>
					<label>
						Ace-Five count
						<input
							type="number"
							step="1"
							value={countInput()}
							onInput={(event) => setCountInput(Number(event.currentTarget.value))}
						/>
					</label>
					<label class="ev-table__checkbox">
						<input
							type="checkbox"
							title="Dealer stands on soft 17"
							checked={standsSoft17Input()}
							onInput={(event) => setStandsSoft17Input(event.currentTarget.checked)}
						/>
						S17
					</label>
					<button type="submit">Calculate</button>
					<Show when={calcTimeMs() !== null}>
						<span class="ev-table__calc-time">
							(took {formatDuration(calcTimeMs()!)})
						</span>
					</Show>
				</form>

				<Show when={error()}>
					{(message) => <p class="ev-table__error">{message()}</p>}
				</Show>
			</div>

			<Show when={!error()}>
				<EvGrid
					title="Hard totals"
					rowHeading="Hard total"
					totals={HARD_TOTALS}
					upcards={RANKS}
					rowsByKey={hardRowsByKey()}
					loading={isComputing()}
				/>
				<EvGrid
					title="Soft totals"
					rowHeading="Soft total"
					totals={SOFT_TOTALS}
					upcards={RANKS}
					rowsByKey={softRowsByKey()}
					rowLabel={formatSoftTotalLabel}
					loading={isComputing()}
				/>
				<SplitEvGrid
					title="Splits"
					pairRanks={PAIR_RANKS}
					upcards={RANKS}
					rowsByKey={splitRowsByKey()}
					loading={isComputing()}
				/>
			</Show>
		</section>
	);
};

export default EvTable;
