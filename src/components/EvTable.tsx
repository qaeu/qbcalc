import { HoverCard } from '@ark-ui/solid/hover-card';
import { createMemo, createSignal, For, Show, type Component } from 'solid-js';

import {
	DEFAULT_RULE_SET,
	HARD_TOTALS,
	RANKS,
	computeEvComparison,
	type EvComparisonResult,
	type EvComparisonRow,
	type PlayerAction,
	type Rank,
} from '#utils/blackjackEv';
import { formatCount, formatDuration } from '#utils/format';
import { loadCalculatorConfig, saveCalculatorConfig } from '#utils/storage';

import EvCellPopover from '#c/EvCellPopover';

import '#styles/EvTable';

interface CalculatorParams {
	decks: number;
	count: number;
	dealerHitsSoft17: boolean;
}

const DEFAULT_PARAMS: CalculatorParams = {
	decks: DEFAULT_RULE_SET.decks,
	count: 1,
	dealerHitsSoft17: DEFAULT_RULE_SET.dealerHitsSoft17,
};

function rowKey(total: number, upcard: Rank): string {
	return `${total}-${upcard}`;
}

interface EvCellProps {
	row: EvComparisonRow;
}

const ACTION_CLASS: Record<PlayerAction, string> = {
	H: 'is-hit',
	S: 'is-stand',
	D: 'is-double',
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

interface EvGridProps {
	title: string;
	comparison: EvComparisonResult;
	rowsByKey: Map<string, EvComparisonRow>;
}

const EvGrid: Component<EvGridProps> = (props) => (
	<div class="ev-table__grid">
		<h3>{props.title}</h3>
		<div class="ev-table__grid-scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Hard total</th>
						<For each={props.comparison.upcards}>
							{(upcard) => <th scope="col">{upcard}</th>}
						</For>
					</tr>
				</thead>
				<tbody>
					<For each={props.comparison.totals}>
						{(total) => (
							<tr>
								<th scope="row">{total}</th>
								<For each={props.comparison.upcards}>
									{(upcard) => (
										<Show
											when={props.rowsByKey.get(rowKey(total, upcard))}
											fallback={<td>—</td>}
										>
											{(row) => <EvCell row={row()} />}
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
	const [params, setParams] = createSignal(initialParams);
	const [error, setError] = createSignal<string | null>(null);
	const [calcTimeMs, setCalcTimeMs] = createSignal<number | null>(null);

	const comparison = createMemo<EvComparisonResult | null>(() => {
		const { decks, count, dealerHitsSoft17 } = params();
		const start = performance.now();
		try {
			const result = computeEvComparison(
				{ decks, dealerHitsSoft17 },
				count,
				HARD_TOTALS,
				RANKS
			);
			setCalcTimeMs(performance.now() - start);
			setError(null);
			return result;
		} catch (err) {
			setCalcTimeMs(null);
			setError(err instanceof Error ? err.message : String(err));
			return null;
		}
	});

	const rowsByKey = createMemo(() => {
		const map = new Map<string, EvComparisonRow>();
		for (const row of comparison()?.rows ?? []) {
			map.set(rowKey(row.total, row.upcard), row);
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
		setParams(nextParams);
		saveCalculatorConfig(nextParams);
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

			<Show when={comparison()}>
				{(result) => (
					<EvGrid
						title={`Optimal play, count ${formatCount(params().count)}`}
						comparison={result()}
						rowsByKey={rowsByKey()}
					/>
				)}
			</Show>
		</section>
	);
};

export default EvTable;
