// Opens a URL in a browser that Playwright provides and keeps it open until
// this process is ended. Needs the playwright package and its browsers
// (npx playwright install --with-deps <browser>).
//
//   node tools/playwright.mjs <chromium|firefox|webkit> <url> [channel]
// Used as the command of tools/run.mjs. Playwright's WebKit is a build of
// WebKit, not Safari: close, but its JavaScript engine is not the one Safari
// ships.
import { chromium, firefox, webkit } from 'playwright';

const [name, url, channel] = process.argv.slice(2);
const type = { chromium, firefox, webkit }[name];
if (!type) { console.error(`playwright.mjs: unknown browser ${name}`); process.exit(2); }
const browser = await type.launch(channel ? { channel } : {});
console.log(`playwright.mjs: ${name} ${browser.version()}`);
const page = await browser.newPage();
page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
const quit = async () => { await browser.close().catch(() => {}); process.exit(0); };
process.on('SIGTERM', quit);
process.on('SIGINT', quit);
await page.goto(url);
setInterval(() => {}, 1 << 30);
