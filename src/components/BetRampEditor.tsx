/**
 * A grid of per-true-count bet size inputs: the bet spread, one bucket a column.
 * The columns are Hi-Lo-equivalent true counts whatever system is selected (see
 * `hiLoCountScale` in `bankroll.ts`), so the same spread describes the same
 * betting behaviour under a level-two count as under Hi-Lo.
 */

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
			{(label, index) => {
				let field!: HTMLInputElement;

				/*
				 * A `<span>`, not a `<label>`: the whole grid already sits inside
				 * the setting's own label, which may not contain another. So the
				 * click a real label would handle is done here -- and the
				 * surrounding label's own activation, which would otherwise send
				 * the caret to the first column wherever in the cell was clicked,
				 * is stopped first.
				 *
				 * The whole cell answers, not just the caption's own glyphs: a
				 * label is clickable across its box, and the caption text in a
				 * column this narrow is a target three characters wide. A click
				 * that reached the field is left alone -- that one is the field's,
				 * and it carries the caret to where it landed.
				 */
				return (
					<span
						class="bet-ramp-editor__bucket"
						onClick={(event) => {
							if (event.target === field) return;
							event.preventDefault();
							field.focus();
							field.select();
						}}
					>
						<span class="bet-ramp-editor__label">{label}</span>
						<input
							ref={field}
							type="number"
							min="0"
							step="1"
							aria-label={`Units bet at Hi-Lo-equivalent true count ${label}`}
							value={props.ramp[index()]}
							onInput={(event) =>
								props.onRampChange(index(), Number(event.currentTarget.value))
							}
						/>
					</span>
				);
			}}
		</For>
	</div>
);

export default BetRampEditor;
