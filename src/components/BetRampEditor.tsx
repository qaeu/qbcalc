/** A grid of per-true-count bet size inputs: the bet spread, one bucket a column. */

import { For, type Component } from 'solid-js';

import { RAMP_LABELS } from '#utils/bankroll';

import '#styles/BetRampEditor';

interface BetRampEditorProps {
	/** Units wagered in each `RAMP_TRUE_COUNTS` bucket. */
	ramp: readonly number[];
	onRampChange: (index: number, units: number) => void;
}

const BetRampEditor: Component<BetRampEditorProps> = (props) => (
	<div class="bet-ramp-editor">
		<For each={RAMP_LABELS}>
			{(label, index) => (
				<span class="bet-ramp-editor__bucket">
					{label}
					<input
						type="number"
						min="0"
						step="1"
						aria-label={`Units bet at true count ${label}`}
						value={props.ramp[index()]}
						onInput={(event) =>
							props.onRampChange(index(), Number(event.currentTarget.value))
						}
					/>
				</span>
			)}
		</For>
	</div>
);

export default BetRampEditor;
