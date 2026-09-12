/** A grid of per-rank tag value inputs for a counting system. */

import { For, type Component } from 'solid-js';

import { RANKS, type Rank } from '#utils/ev/cards';
import type { TagValues } from '#utils/ev/composition';

import '#styles/settings/TagValueGrid';

interface TagValueGridProps {
	tags: TagValues;
	onTagChange: (rank: Rank, value: number) => void;
}

/** Ranks are stored as 'T' but read as "10" on a table. */
function rankLabel(rank: Rank): string {
	return rank === 'T' ? '10' : rank;
}

const TagValueGrid: Component<TagValueGridProps> = (props) => (
	<div class="tag-value-grid">
		<For each={RANKS}>
			{(rank) => {
				let field!: HTMLInputElement;

				/*
				 * A `<span>`, not a `<label>`: the grid sits inside the setting's
				 * own label, which may not contain another. The click a real label
				 * would handle is done here -- across the whole cell, as a label is
				 * clickable across its box -- and the surrounding label's
				 * activation, which would put the caret in the Ace field wherever
				 * in the cell was clicked, is stopped first. A click that reached
				 * the field is left alone.
				 */
				return (
					<span
						class="tag-value-grid__tag"
						onClick={(event) => {
							if (event.target === field) return;
							event.preventDefault();
							field.focus();
							field.select();
						}}
					>
						<span class="tag-value-grid__label">{rankLabel(rank)}</span>
						<input
							ref={field}
							type="number"
							step="1"
							aria-label={`Tag value for ${rankLabel(rank)}`}
							value={props.tags[rank]}
							onInput={(event) =>
								props.onTagChange(rank, Number(event.currentTarget.value))
							}
						/>
					</span>
				);
			}}
		</For>
	</div>
);

export default TagValueGrid;
