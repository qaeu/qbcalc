import { Tabs } from '@ark-ui/solid/tabs';
import type { Component } from 'solid-js';

import type { AppTab } from '#utils/hashRoute';

import '#styles/AppHeader';

interface AppHeaderProps {
	tab: AppTab;
	onTabChange: (tab: AppTab) => void;
}

const AppHeader: Component<AppHeaderProps> = (props) => (
	<header class="app-header">
		<Tabs.Root
			value={props.tab}
			onValueChange={(details) => props.onTabChange(details.value as AppTab)}
			class="app-header__inner"
		>
			<h1 class="app-header__title">Blackjack EV Calculator</h1>
			<Tabs.List class="app-header__tab-list">
				<Tabs.Trigger value="tables" class="app-header__tab">
					Tables
				</Tabs.Trigger>
				<Tabs.Trigger value="bankroll" class="app-header__tab">
					Bankroll
				</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>
	</header>
);

export default AppHeader;
