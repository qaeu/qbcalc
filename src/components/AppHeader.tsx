import { Tabs } from '@ark-ui/solid/tabs';
import { Show, type Component } from 'solid-js';

import { SlidersHorizontal } from 'lucide-solid';

import type { AppTab } from '#utils/hashRoute';

import '#styles/AppHeader';

interface AppHeaderProps {
	tab: AppTab;
	onTabChange: (tab: AppTab) => void;
	/**
	 * Opens the settings drawer, on the layouts that have one. The button is
	 * hidden by the same media query that decides whether the sidebar is in the
	 * page at all, so a desktop render never shows it even when handed one.
	 */
	onOpenSettings?: () => void;
}

const AppHeader: Component<AppHeaderProps> = (props) => (
	<header class="app-header">
		<Tabs.Root
			value={props.tab}
			onValueChange={(details) => props.onTabChange(details.value as AppTab)}
			class="app-header__inner"
		>
			<div class="app-header__title-row">
				<h1 class="app-header__title">Blackjack EV Calculator</h1>
				<Show when={props.onOpenSettings}>
					{(open) => (
						<button
							type="button"
							class="app-header__settings"
							aria-label="Settings"
							onClick={() => open()()}
						>
							<SlidersHorizontal />
						</button>
					)}
				</Show>
			</div>
			<Tabs.List class="app-header__tab-list">
				<Tabs.Trigger value="tables" class="app-header__tab">
					Tables
				</Tabs.Trigger>
				<Tabs.Trigger value="bankroll" class="app-header__tab">
					Bankroll
				</Tabs.Trigger>
				<Tabs.Trigger value="play" class="app-header__tab">
					Play
				</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>
	</header>
);

export default AppHeader;
