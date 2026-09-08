// Renders tools/og-card.html to public/og-image.png, the image the Open Graph
// tags in index.html point a scraper at.
//
// A headless browser rather than a drawing library: the card is written in the
// app's own CSS -- the same palette steps, the same print, the same cell fills
// -- so the thing that renders it has to be the thing that renders the app, or
// keeping the two in step would mean translating every change by hand.
//
// Run with `npm run og:image`, and commit the PNG it writes: the build only
// copies `public/`, so nothing regenerates the card at deploy time. Needs a
// network connection, since the card pulls Archivo from Google Fonts exactly
// as the page does.
import { chromium } from 'playwright';

// The dimensions Facebook, X, Discord and Slack all preview at 1.91:1 without
// cropping, and the values index.html declares in og:image:width/height.
const WIDTH = 1200;
const HEIGHT = 630;

// The card is addressed relative to this file, the image relative to the
// working directory: `screenshot` wants a filesystem path rather than a URL,
// and resolving one here would mean a `node:url` import and the Node types to
// go with it. npm runs a script from the package root, so the two agree.
const CARD_URL = new URL('./og-card.html', import.meta.url).href;
const OUT_PATH = 'public/og-image.png';

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
	await page.goto(CARD_URL);
	// Both waits earn their place: the first blocks on the webfonts, without
	// which the card renders in a fallback face, and the second gives the
	// layout they land in a frame to settle before the shutter.
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(500);
	await page.screenshot({ path: OUT_PATH });
} finally {
	await browser.close();
}
