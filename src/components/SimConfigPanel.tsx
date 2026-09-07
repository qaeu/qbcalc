/**
 * The in-page form for a run, plus the button that starts one and the bar that
 * reports it. Built from the same `SettingsItem` / `SettingSelect` pair the
 * sidebar is, so a setting reads the same wherever it happens to live.
 */

import { Progress } from '@ark-ui/solid/progress';
import { Show, type Component } from 'solid-js';

import { formatRounds } from '#utils/format';
import {
	CUT_CARD_VARIANCES,
	DEVIATION_MODES,
	OTHER_SPOTS,
	ROUND_COUNTS,
	WONG_IN_COUNTS,
	WONG_OUT_COUNTS,
	type SimConfig,
} from '#utils/sim/config';

import SettingSelect, { type SettingOption } from '#c/SettingSelect';
import SettingsItem from '#c/SettingsItem';

import '#styles/SimConfigPanel';

/** How far along a run is, as the worker last reported it. */
export interface SimProgress {
	phase: 'pricing' | 'dealing';
	roundsDealt: number;
	rounds: number;
}

interface SimConfigPanelProps {
	config: SimConfig;
	onChange: <K extends keyof SimConfig>(key: K, value: SimConfig[K]) => void;
	running: boolean;
	progress: SimProgress | undefined;
	onRun: () => void;
	onCancel: () => void;
}

/**
 * The numeric option lists come through `SettingSelect`, which is keyed on
 * strings -- so each one is turned into its own decimal string on the way in and
 * parsed back on the way out. One place, rather than six.
 */
function numericOptions(
	options: readonly { value: number; label: string }[]
): SettingOption<string>[] {
	return options.map((option) => ({ value: String(option.value), label: option.label }));
}

const SimConfigPanel: Component<SimConfigPanelProps> = (props) => {
	const percentDone = () => {
		const progress = props.progress;
		if (!progress || progress.rounds <= 0) return 0;
		return Math.min(100, (progress.roundsDealt / progress.rounds) * 100);
	};

	const status = () => {
		const progress = props.progress;
		if (!progress) return 'Ready';
		if (progress.phase === 'pricing') return 'Pricing the counts…';
		return `${formatRounds(progress.roundsDealt)} of ${formatRounds(progress.rounds)} rounds`;
	};

	return (
		<section class="sim-config">
			<h2 class="sim-config__title">The run</h2>
			<div class="sim-config__grid">
				<SettingsItem
					label="Rounds"
					helptext="Rounds dealt at the table, whether or not the player wagers on them. It is the session being sized, not the action in it — a back-counter who sits out most of a shoe has still stood there for all of it, and the result says how much of the run went that way."
				>
					<SettingSelect
						options={numericOptions(ROUND_COUNTS)}
						value={String(props.config.rounds)}
						onChange={(value) => props.onChange('rounds', Number(value))}
					/>
				</SettingsItem>
				<SettingsItem
					label="Deviations"
					helptext="How the hands are played. Basic strategy never departs from the full-shoe grids; Illustrious 18 lays the eighteen best-known indices over them; Full indices plays the count-adjusted grids outright, which is the ceiling."
				>
					<SettingSelect
						options={DEVIATION_MODES}
						value={props.config.deviations}
						onChange={(value) => props.onChange('deviations', value)}
					/>
				</SettingsItem>
				<SettingsItem
					label="Cut card variance"
					helptext="How far the cut card may sit either side of the penetration set in the rules, redrawn on every shuffle. A real dealer does not place it to the card."
				>
					<SettingSelect
						options={numericOptions(CUT_CARD_VARIANCES)}
						value={String(props.config.cutCardVarianceDecks)}
						onChange={(value) => props.onChange('cutCardVarianceDecks', Number(value))}
					/>
				</SettingsItem>
				<SettingsItem
					label="Wong in"
					helptext="The true count the player sits down at. Below it the round is still dealt — the cards burn and the count moves — but nothing is wagered."
				>
					<SettingSelect
						options={numericOptions(WONG_IN_COUNTS)}
						value={String(props.config.wongInCount)}
						onChange={(value) => props.onChange('wongInCount', Number(value))}
					/>
				</SettingsItem>
				<SettingsItem
					label="Wong out"
					helptext="And the count they get up below, once seated. Set under the wong-in count it holds the seat as the shoe cools rather than leaving the moment it stops being worth sitting down for; left never, the wong-in count does both jobs."
				>
					<SettingSelect
						options={numericOptions(WONG_OUT_COUNTS)}
						value={String(props.config.wongOutCount)}
						onChange={(value) => props.onChange('wongOutCount', Number(value))}
					/>
				</SettingsItem>
				<SettingsItem
					label="Other players"
					helptext="Players sharing the table. Their hands are modelled as cards burned between rounds: what they cost the counter is penetration, not decisions."
				>
					<SettingSelect
						options={numericOptions(OTHER_SPOTS)}
						value={String(props.config.otherSpots)}
						onChange={(value) => props.onChange('otherSpots', Number(value))}
					/>
				</SettingsItem>
				<SettingsItem
					label="Seed"
					helptext="The shuffle seed. With re-seeding off, the same seed deals exactly the same session again."
				>
					<input
						class="sim-config__number"
						type="number"
						value={props.config.seed}
						disabled={props.running}
						onChange={(event) => {
							const seed = Number(event.currentTarget.value);
							if (Number.isFinite(seed)) props.onChange('seed', seed);
						}}
					/>
				</SettingsItem>
				<SettingsItem
					label="New seed each run"
					layout="row"
					helptext="On, every run deals a fresh session and the seed box shows what it used. Off, runs repeat."
				>
					<input
						type="checkbox"
						checked={props.config.reseedEachRun}
						onChange={(event) =>
							props.onChange('reseedEachRun', event.currentTarget.checked)
						}
					/>
				</SettingsItem>
			</div>

			<div class="sim-config__actions">
				<Show
					when={props.running}
					fallback={
						<button type="button" class="sim-config__run" onClick={() => props.onRun()}>
							Run simulation
						</button>
					}
				>
					<button
						type="button"
						class="sim-config__cancel"
						onClick={() => props.onCancel()}
					>
						Cancel
					</button>
				</Show>
				{/*
				 * Ark's progress rather than a styled div of our own: a run is minutes
				 * long at the top of the range, so it is the one thing on this page a
				 * screen reader has to be able to ask about -- and the fill's width is
				 * the datum, which is exactly the sort of wiring the headless component
				 * owns and a stylesheet cannot.
				 */}
				<Progress.Root
					class="sim-config__progress"
					value={percentDone()}
					min={0}
					max={100}
				>
					<Progress.Label class="sim-config__progress-label">
						Simulation progress
					</Progress.Label>
					<Progress.Track class="sim-config__bar">
						<Progress.Range class="sim-config__bar-fill" />
					</Progress.Track>
					<span class="sim-config__status">{status()}</span>
				</Progress.Root>
			</div>
		</section>
	);
};

export default SimConfigPanel;
