import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid/configs/recommended';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
	globalIgnores(['dist', 'coverage', '*.config.js']),
	js.configs.recommended,
	tseslint.configs.recommended,
	{
		...solid,
		files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
		languageOptions: {
			globals: globals.browser,
			parserOptions: { project: 'tsconfig.json' },
		},
	},
	// The build tooling is plain ESM, outside tsconfig's program -- `allowJs`
	// is off, so a typed parse of it can only fail to find it. Linted without
	// the project, and against Node's globals as well as the browser's: the
	// script is Node, but the callbacks it hands a page are not.
	{
		files: ['tools/**/*.mjs'],
		languageOptions: {
			globals: { ...globals.node, ...globals.browser },
			parserOptions: { project: null },
		},
	},
]);
