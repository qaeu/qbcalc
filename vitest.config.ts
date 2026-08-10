import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
	plugins: [solidPlugin()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/setupTests.ts'],
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
