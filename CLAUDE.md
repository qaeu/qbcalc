# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The canonical development guide for this repository is [AGENTS.md](./AGENTS.md) — read it first. It covers the architecture, subpath import aliases, TypeScript/SolidJS/SCSS conventions, and EV engine guidelines. [TESTING.md](./TESTING.md) covers the test setup.

Points worth repeating here:

- **Formatting is enforced**: Prettier with tabs, single quotes, 90-column width. Run `npm run lint` and `npm run format` before committing.
- **Pages base path**: `vite.config.ts` sets `base: '/qbcalc/'` to match the GitHub Pages URL. Changing the repo name means changing this.
- **The app is still early**: `src/utils/ev/` has one EV engine (running-count hit/stand deltas for hard totals, soft totals and pairs, under an arbitrary per-rank tag vector), rendered by `src/components/EvTable.tsx`. Don't assume other strategy/rule coverage exists beyond that.
- **The EV model is documented**: [docs/ev-model.md](./docs/ev-model.md) holds the method, its simplifications, and the performance reasoning behind the engine's shape. Read it before changing anything under `src/utils/ev/`, and put new reasoning there rather than in a long source comment.
