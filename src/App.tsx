import type { Component } from 'solid-js';

import EvTable from '#c/EvTable';

import '#styles/App';

const App: Component = () => {
	return (
		<main class="app">
			<h1>Blackjack EV Calculator</h1>
			<EvTable />
		</main>
	);
};

export default App;
