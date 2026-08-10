# qbcalc — Blackjack EV Calculator

A client-side calculator for expected value (EV) in blackjack. Built with **SolidJS** and **Vite**.

## Installation

```bash
npm install
```

## Available Scripts

In the project directory, you can run:

### `npm run dev` or `npm start`

Runs the app in development mode.<br>
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br>

### `npm run build`

Builds the app for production to the `dist` folder.<br>
It correctly bundles Solid in production mode and optimizes the build for the best performance.

### `npm test`

Runs unit tests with Vitest. See [TESTING.md](./TESTING.md) for more details.

### `npm run lint` / `npm run format`

Runs ESLint and Prettier respectively.

## Deployment

Pushes to `main` are automatically built and published to [GitHub Pages](https://qaeu.github.io/qbcalc/) by the [deploy workflow](.github/workflows/deploy.yml).

Note that `vite.config.ts` sets `base: '/qbcalc/'` to match the Pages path — keep these in sync.

## Documentation

- [AGENTS.md](./AGENTS.md) — Development guidelines and project architecture
- [TESTING.md](./TESTING.md) — Testing setup and best practices

## Learn More

- [SolidJS Documentation](https://solidjs.com)
- [Vite Documentation](https://vitejs.dev)

## License

[AGPL-3.0](./LICENSE)
