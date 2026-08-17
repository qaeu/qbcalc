import { createMemo, Show, type Accessor, type Component } from 'solid-js';

import type { BankrollAnalysis } from '#utils/bankroll';

import CountEvGraph, { type CountEvProfile } from '#c/CountEvGraph';
import EvSummary from '#c/EvSummary';

import '#styles/BankrollOutput';

// Distinct from EvTable's own grid salts, so the summary cards and graph
// scatter differently from any table cells that happen to share a seed.
const CARD_SALTS = {
	summary: 0x27d4eb2f,
	countEv: 0x165667b1,
} as const;

interface BankrollOutputProps {
	error: Accessor<string | null>;
	/**
	 * Loading state for the summary cards and the graph alone. It is not the
	 * grids' `isComputing`: these describe the whole shoe, so a recalculation
	 * at a new count leaves them showing what they already show rather than
	 * blanking them.
	 */
	isSummaryComputing: Accessor<boolean>;
	bankroll: Accessor<BankrollAnalysis | undefined>;
	countEv: Accessor<CountEvProfile | undefined>;
}

const BankrollOutput: Component<BankrollOutputProps> = (props) => {
	// Redrawn each time a summary calculation starts, so consecutive runs
	// don't replay the same skeleton scatter. Holds its value while results
	// are on screen, which keeps a card's phase stable for as long as the
	// skeleton is visible.
	const runSeed = createMemo<number>(
		(previous) =>
			props.isSummaryComputing() ? Math.floor(Math.random() * 0x100000000) : previous,
		0
	);

	return (
		<section class="bankroll-output">
			<Show when={props.error()}>
				{(message) => <p class="bankroll-output__error">{message()}</p>}
			</Show>
			<Show when={!props.error()}>
				<EvSummary
					bankroll={props.bankroll()}
					loading={props.isSummaryComputing()}
					seed={runSeed() ^ CARD_SALTS.summary}
				/>
				<CountEvGraph
					profile={props.countEv()}
					loading={props.isSummaryComputing()}
					seed={runSeed() ^ CARD_SALTS.countEv}
				/>
			</Show>
		</section>
	);
};

export default BankrollOutput;
