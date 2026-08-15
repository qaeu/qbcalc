/** A grid of per-rank tag value inputs for a counting system. */

import { For, type Component } from 'solid-js';

import { RANKS, type Rank } from '#utils/ev/cards';
import type { TagValues } from '#utils/ev/composition';

import '#styles/TagValueGrid';

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
			{(rank) => (
				<span class="tag-value-grid__tag">
					{rankLabel(rank)}
					<input
						type="number"
						step="1"
						aria-label={`Tag value for ${rankLabel(rank)}`}
						value={props.tags[rank]}
						onInput={(event) =>
							props.onTagChange(rank, Number(event.currentTarget.value))
						}
					/>
				</span>
			)}
		</For>
	</div>
);

export default TagValueGrid;
