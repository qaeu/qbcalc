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
		rules: {
			// Solid's own rules, which spreading `solid` above would otherwise
			// carry and this key would then replace.
			...solid.rules,
			// A `let` bound by `ref={...}` is assigned by the JSX compiler, not in
			// the source, so this rule reads every Solid ref as never assigned.
			'no-unassigned-vars': 'off',
		},
	},
]);
