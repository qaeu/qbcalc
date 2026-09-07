# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The canonical development guide for this repository is [AGENTS.md](./AGENTS.md) — read it first. It covers the architecture, subpath import aliases, TypeScript/SolidJS/SCSS conventions, and EV engine guidelines. [TESTING.md](./TESTING.md) covers the test setup.

Points worth repeating here:

- **Formatting is enforced**: Prettier with tabs, single quotes, 90-column width. Run `npm run lint` and `npm run format` before committing.
- **Pages base path**: `vite.config.ts` sets `base: '/qbcalc/'` to match the GitHub Pages URL. Changing the repo name means changing this.
- **The app is still early**: `src/utils/ev/` has one EV engine (running-count hit/stand deltas for hard totals, soft totals and pairs, under an arbitrary per-rank tag vector), rendered by `src/components/EvTable.tsx`. Don't assume other strategy/rule coverage exists beyond that.
- **Two workers, not one**: `src/utils/blackjackEv.worker.ts` is a calculator — one in-flight request, no progress, no cancellation. `src/utils/sim.worker.ts` runs a session of dealt hands in chunks, with progress and cancellation, because a minutes-long run does not belong behind the calculator's protocol.
- **The EV model is documented**: [docs/ev-model.md](./docs/ev-model.md) holds the method, its simplifications, and the performance reasoning behind the engine's shape. Read it before changing anything under `src/utils/ev/`, and put new reasoning there rather than in a long source comment. [docs/bankroll-model.md](./docs/bankroll-model.md) covers `src/utils/bankroll.ts` — count frequency, bet spread and risk of ruin — the same way, [docs/count-rounds-model.md](./docs/count-rounds-model.md) covers `src/utils/countRounds.ts`, the seeded shoe simulation behind the weighted-EV graph card, [docs/play-model.md](./docs/play-model.md) covers `src/utils/play/` — the dealt game behind the Play view, how it grades a decision, and what it records — and [docs/sim-model.md](./docs/sim-model.md) covers `src/utils/sim/`, the simulated session behind the Sim view, the deviation modes it plays under, and why its EV is accumulated per round rather than per decision.
