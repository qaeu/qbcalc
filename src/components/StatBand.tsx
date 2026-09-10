/**
 * One band of figures printed on the table: a label, a number set large, an
 * optional unit, and the +/- colouring where a sign carries meaning.
 *
 * The Play stats and the Sim stats had the same markup and the same stylesheet
 * twice over, which is what AGENTS.md's "wrap, don't scatter" is for. `EvSummary`
 * still keeps its own copy: its cards carry loading skeletons scattered across a
 * pulse cycle, and that phase machinery has nothing to do with reading a figure.
 */

import { For, Show, type Component } from 'solid-js';

import { signClass } from '#utils/actionStyle';
import { createBalancedLastLine } from '#utils/gridBalance';

import '#styles/StatBand';

/** What a figure with nothing behind it yet reads as. */
export const NO_FIGURE = '—';

export interface StatFigure {
	label: string;
	/** Already formatted -- the band's figures do not share a unit. */
	value: string;
	/** The unit the figure is in, set small beside it. */
	unit?: string;
	/** The number the +/- colouring keys off, where its sign means something. */
	sign?: number;
	/**
	 * A second reading of the same quantity, set under the figure -- what the
	 * Bankroll view predicts, against what the sim actually dealt.
	 */
	note?: string;
}

interface StatBandProps {
	figures: readonly StatFigure[];
}

const StatBand: Component<StatBandProps> = (props) => {
	let band: HTMLDivElement | undefined;
	createBalancedLastLine(
		() => band,
		() => props.figures.length
	);

	return (
		<div class="stat-band" ref={band}>
			<For each={props.figures}>
				{(figure) => (
					<div class="stat-band__card">
						<span class="stat-band__label">{figure.label}</span>
						<span
							class={`stat-band__value ${
								figure.sign === undefined ? '' : (signClass(figure.sign) ?? '')
							}`}
						>
							{figure.value}
							<Show when={figure.unit}>
								<span class="stat-band__unit">{figure.unit}</span>
							</Show>
						</span>
						<Show when={figure.note}>
							<span class="stat-band__note">{figure.note}</span>
						</Show>
					</div>
				)}
			</For>
		</div>
	);
};

export default StatBand;
