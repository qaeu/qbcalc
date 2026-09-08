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
]);
