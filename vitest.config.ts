import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
	plugins: [solidPlugin()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/setupTests.ts'],
		// `npm test` runs both; `npm run test:unit` and `npm run test:integration`
		// run one. The split is by what a test drives, not by what it asserts:
		// the integration project renders the whole app over the real worker and
		// the real engine, and costs seconds a case for it. Each project inherits
		// the plugin, the aliases and the setup above; only the files differ.
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					include: ['tests/**/*.test.{ts,tsx}'],
					exclude: ['**/node_modules/**', 'tests/integration/**'],
				},
			},
			{
				extends: true,
				test: {
					name: 'integration',
					include: ['tests/integration/**/*.test.{ts,tsx}'],
				},
			},
		],
	},
	resolve: {
		conditions: ['development', 'browser'],
		extensions: ['.ts', '.tsx', '.js', '.jsx', '.scss'],
		// Most specific prefix first: '#' would otherwise swallow '#c/' and '#styles/'.
		// Keep the trailing slashes so '#c/' cannot also match e.g. '#calculator'.
		alias: {
			'#c/': '/src/components/',
			'#styles/': '/src/styles/',
			'#': '/src/',
		},
	},
});
