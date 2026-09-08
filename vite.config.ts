import { defineConfig, type Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';

// Where the app is published, in one place. `base` has to match the GitHub
// Pages URL for the built asset paths to resolve, and the Open Graph tags in
// index.html have to carry the same URL absolutely -- a scraper reads the
// markup with no page base to resolve a relative one against, and Vite's own
// rewriting covers `href`/`src` attributes but not a `<meta>`'s `content`.
// Renaming the repo or moving the site is then this pair of constants.
const ORIGIN = 'https://qaeu.github.io';
const REPO = 'qbcalc';

const BASE = `/${REPO}/`;
const SITE_URL = `${ORIGIN}${BASE}`;

/**
 * Substitutes `%SITE_URL%` in index.html. Runs `pre` so the placeholder is
 * gone before Vite's own `%ENV%` pass sees it, and applies in dev as well as
 * in the build, so the served markup is never the raw template.
 */
function siteUrl(): Plugin {
	return {
		name: 'qbcalc:site-url',
		enforce: 'pre',
		transformIndexHtml: {
			order: 'pre',
			handler: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
		},
	};
}

export default defineConfig({
	plugins: [siteUrl(), solidPlugin()],
	server: {
		port: 3000,
	},
	build: {
		target: 'esnext',
	},
	base: BASE,
});
