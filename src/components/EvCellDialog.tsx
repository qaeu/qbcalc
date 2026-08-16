/**
 * The drill-down behind a grid cell: where the hover card answers "what should
 * I do", this answers "why", by pricing every action the table offers this
 * hand side by side instead of only the one that won.
 */

import { Dialog } from '@ark-ui/solid/dialog';
import { Portal } from 'solid-js/web';
import { createMemo, For, Match, Show, Switch, type Component } from 'solid-js';

import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, X } from 'lucide-solid';

import type { Rank } from '#utils/ev/cards';
import type { ActionAnalysis } from '#utils/ev/outcome';
import type { EvCellData } from '#utils/ev/tables';
import {
	formatActionLabel,
	formatCount,
	formatEvPercent,
	formatPercent,
} from '#utils/format';
import { ACTION_CLASS, signClass } from '#utils/actionStyle';

import '#styles/EvCellDialog';

interface EvCellDialogProps {
	row: EvCellData;
	trueCount: number;
	/** The player's hand as the grid labels it, e.g. "Hard 16", "A,7", "8,8". */
	hand: string;
	upcard: Rank;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const EvCellDialog: Component<EvCellDialogProps> = (props) => {
	// Best first, which is not the order the engine reports them in: the point
	// of the list is the ranking, and reading it top-down should be reading it
	// in preference order. Sorting is stable, so actions that tie stay in the
	// engine's own precedence order -- the same tie-break that picked the
	// optimal action, so that one still comes first.
	const rankedActions = createMemo(() =>
		[...props.row.actions].sort((a, b) => b.evPercent - a.evPercent)
	);

	// Where each action stood before the count moved it, so the table can show
	// how far it climbed or slid rather than just where it ended up.
	const baseRanks = createMemo(() => {
		const ranked = [...props.row.baseActions].sort((a, b) => b.evPercent - a.evPercent);
		const ranks = new Map<string, number>();
		ranked.forEach((action, index) => ranks.set(action.action, index + 1));
		return ranks;
	});

	const hasSplit = createMemo(() =>
		props.row.actions.some((action) => action.action === 'P')
	);

	return (
		<Dialog.Root
			open={props.open}
			onOpenChange={(details) => props.onOpenChange(details.open)}
			// Locking the body would pull the page's scrollbar out from under the
			// dialog and shift the grid behind it sideways. The dialog is short
			// enough to sit in the viewport, so nothing needs the page held still.
			preventScroll={false}
		>
			<Portal>
				<Dialog.Backdrop class="ev-cell-dialog__backdrop" />
				<Dialog.Positioner class="ev-cell-dialog__positioner">
					<Dialog.Content class="ev-cell-dialog">
						<header class="ev-cell-dialog__header">
							<div>
								<Dialog.Title class="ev-cell-dialog__title">
									{props.hand} vs {props.upcard}
								</Dialog.Title>
								<Dialog.Description class="ev-cell-dialog__subtitle">
									True count {formatCount(props.trueCount)} &middot; dealer busts{' '}
									{formatPercent(props.row.dealerBustPercent)}
								</Dialog.Description>
							</div>
							<Dialog.CloseTrigger class="ev-cell-dialog__close" aria-label="Close">
								<X />
							</Dialog.CloseTrigger>
						</header>

						<table class="ev-cell-dialog__actions">
							<thead>
								<tr>
									<th scope="col" class="ev-cell-dialog__rank-col">
										#
									</th>
									<th
										scope="col"
										class="ev-cell-dialog__deviation-col"
										aria-hidden="true"
									/>
									<th scope="col" class="ev-cell-dialog__action-col">
										Action
									</th>
									<th scope="col">EV</th>
									<th scope="col">Win</th>
									<th scope="col">Push</th>
									<th scope="col">Lose</th>
								</tr>
							</thead>
							<tbody>
								<For each={rankedActions()}>
									{(action: ActionAnalysis, index) => {
										// How far this action's rank has moved from where it stood
										// against the unadjusted shoe: positive is a climb, negative a
										// slide, relative to the same ranking read at a count of 0.
										const rankDelta = createMemo(() => {
											const baseRank = baseRanks().get(action.action);
											return baseRank === undefined ? 0 : baseRank - (index() + 1);
										});

										return (
											<tr
												classList={{
													'is-optimal': action.action === props.row.optimalAction,
												}}
											>
												<td class="ev-cell-dialog__rank-col">{index() + 1}</td>
												<td class="ev-cell-dialog__deviation-col">
													<Switch>
														<Match when={rankDelta() === 1}>
															<ChevronUp class="is-positive" />
														</Match>
														<Match when={rankDelta() > 1}>
															<ChevronsUp class="is-positive" />
														</Match>
														<Match when={rankDelta() === -1}>
															<ChevronDown class="is-negative" />
														</Match>
														<Match when={rankDelta() < -1}>
															<ChevronsDown class="is-negative" />
														</Match>
													</Switch>
												</td>
												<th scope="row">
													<span
														class={`ev-cell-dialog__action ${ACTION_CLASS[action.action]}`}
													>
														{formatActionLabel(action.action)}
													</span>
												</th>
												<td class={signClass(action.evPercent)}>
													{formatEvPercent(action.evPercent)}%
												</td>
												{/* Surrender settles for a flat half-loss with no showdown, so
												    there is no win/push/lose to report against it. */}
												<Show
													when={action.outcome}
													fallback={
														<>
															<td>&mdash;</td>
															<td>&mdash;</td>
															<td>&mdash;</td>
														</>
													}
												>
													{(outcome) => (
														<>
															<td>{formatPercent(outcome().winPercent)}</td>
															<td>{formatPercent(outcome().pushPercent)}</td>
															<td>{formatPercent(outcome().losePercent)}</td>
														</>
													)}
												</Show>
											</tr>
										);
									}}
								</For>
							</tbody>
						</table>

						<Show when={hasSplit()}>
							<p class="ev-cell-dialog__note">
								Splitting turns one wager into two: its EV covers both hands, while its
								win, push and lose odds are those of a single hand.
							</p>
						</Show>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
};

export default EvCellDialog;
