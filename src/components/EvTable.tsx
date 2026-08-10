import { createMemo, createSignal, For, Show, type Component } from 'solid-js';

import {
	DEFAULT_RULE_SET,
	HARD_TOTALS,
	RANKS,
	computeEvComparison,
	type EvComparisonResult,
	type EvComparisonRow,
	type Rank,
} from '#utils/blackjackEv';

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

interface EvGridProps {
	title: string;
	comparison: EvComparisonResult;
	rowsByKey: Map<string, EvComparisonRow>;
	select: (row: EvComparisonRow) => number;
}

function rowKey(total: number, upcard: Rank): string {
	return `${total}-${upcard}`;
}

function formatEv(value: number): string {
	const rounded = value.toFixed(3);
	return value > 0 ? `+${rounded}` : rounded;
}

function formatCount(value: number): string {
	return value >= 0 ? `+${value}` : `${value}`;
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
									{(upcard) => {
										const row = props.rowsByKey.get(rowKey(total, upcard));
										const value = row ? props.select(row) : 0;
										return (
											<td
												classList={{ 'is-positive': value > 0, 'is-negative': value < 0 }}
											>
												{formatEv(value)}
											</td>
										);
									}}
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
	const [decksInput, setDecksInput] = createSignal(DEFAULT_PARAMS.decks);
	const [countInput, setCountInput] = createSignal(DEFAULT_PARAMS.count);
	const [standsSoft17Input, setStandsSoft17Input] = createSignal(
		!DEFAULT_PARAMS.dealerHitsSoft17
	);
	const [params, setParams] = createSignal(DEFAULT_PARAMS);
	const [error, setError] = createSignal<string | null>(null);

	const comparison = createMemo<EvComparisonResult | null>(() => {
		const { decks, count, dealerHitsSoft17 } = params();
		try {
			const result = computeEvComparison(
				{ decks, dealerHitsSoft17 },
				count,
				HARD_TOTALS,
				RANKS
			);
			setError(null);
			return result;
		} catch (err) {
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
		setParams({
			decks: decksInput(),
			count: countInput(),
			dealerHitsSoft17: !standsSoft17Input(),
		});
	};

	return (
		<section class="ev-table">
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
						checked={standsSoft17Input()}
						onInput={(event) => setStandsSoft17Input(event.currentTarget.checked)}
					/>
					Dealer stands on soft 17
				</label>
				<button type="submit">Calculate</button>
			</form>

			<Show when={error()}>
				{(message) => <p class="ev-table__error">{message()}</p>}
			</Show>

			<Show when={comparison()}>
				{(result) => (
					<>
						<EvGrid
							title="Baseline optimal-action EV (% of bet)"
							comparison={result()}
							rowsByKey={rowsByKey()}
							select={(row) => row.baseEvPercent}
						/>
						<EvGrid
							title={`EV delta vs. baseline, count ${formatCount(params().count)} (percentage points)`}
							comparison={result()}
							rowsByKey={rowsByKey()}
							select={(row) => row.deltaPercentPoints}
						/>
					</>
				)}
			</Show>
		</section>
	);
};

export default EvTable;
