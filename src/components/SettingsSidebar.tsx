import { createSignal, Show, type Component } from 'solid-js';

import { type CalculatorParams } from '#utils/blackjackEv';
import { formatDuration } from '#utils/format';
import { saveCalculatorConfig } from '#utils/storage';

import '#styles/SettingsSidebar';

interface SettingsSidebarProps {
	initialParams: CalculatorParams;
	calcTimeMs: number | null;
	onSubmit: (params: CalculatorParams) => void;
}

const SettingsSidebar: Component<SettingsSidebarProps> = (props) => {
	const [decksInput, setDecksInput] = createSignal(props.initialParams.decks);
	const [countInput, setCountInput] = createSignal(props.initialParams.count);
	const [standsSoft17Input, setStandsSoft17Input] = createSignal(
		!props.initialParams.dealerHitsSoft17
	);

	const handleSubmit = (event: SubmitEvent) => {
		event.preventDefault();
		const nextParams: CalculatorParams = {
			decks: decksInput(),
			count: countInput(),
			dealerHitsSoft17: !standsSoft17Input(),
		};
		saveCalculatorConfig(nextParams);
		props.onSubmit(nextParams);
	};

	return (
		<aside class="settings-sidebar">
			<h2>Settings</h2>
			<form class="settings-sidebar__controls" onSubmit={handleSubmit}>
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
				<label class="settings-sidebar__checkbox">
					<input
						type="checkbox"
						title="Dealer stands on soft 17"
						checked={standsSoft17Input()}
						onInput={(event) => setStandsSoft17Input(event.currentTarget.checked)}
					/>
					S17
				</label>
				<button type="submit">Calculate</button>
				<Show when={props.calcTimeMs !== null}>
					<span class="settings-sidebar__calc-time">
						(took {formatDuration(props.calcTimeMs!)})
					</span>
				</Show>
			</form>
		</aside>
	);
};

export default SettingsSidebar;
