/**
 * End-to-end Phase 2 verification.
 *
 * Visits every screen in the embedded admin, captures screenshots, and
 * asserts key elements/behaviors. Run with:
 *
 *   node verify-all.mjs
 *
 * Requires auth.json (saved Shopify admin session) at the repo root.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const STORE = 'zernio-dev-testing';
const BASE = `https://admin.shopify.com/store/${STORE}/apps/zernio`;

mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  storageState: 'auth.json',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

const errors = [];
const consoleErrors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 250));
});

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function gotoApp(path = '') {
  const url = path ? `${BASE}/app/${path}` : BASE;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Wait for embedded iframe to mount — App Bridge takes a beat
  await page.waitForTimeout(7000);
  return page.frames().find((f) => f.url().includes('shopify.zernio.com'));
}

async function shot(name) {
  const file = `shots/${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

// ── 1. Home dashboard ───────────────────────────────────────────────
{
  console.log('\n— Home dashboard —');
  const frame = await gotoApp('');
  await shot('1-home');
  const html = frame ? await frame.content() : '';
  log('home: stat cards rendered', html.includes('Posts created this week'));
  log('home: recent posts section', html.includes('Recent posts'));
  log('home: nav has Templates link', html.includes('/app/templates'));
}

// ── 2. Products grid ────────────────────────────────────────────────
{
  console.log('\n— Products —');
  const frame = await gotoApp('products');
  await shot('2-products');
  const html = frame ? await frame.content() : '';
  log('products: grid renders', html.includes('Share to social'));
  log('products: search field present', html.includes('Search products'));
  log('products: select-all checkbox present', /select all/i.test(html));
}

// ── 3. Templates list (likely empty) ────────────────────────────────
{
  console.log('\n— Templates list —');
  const frame = await gotoApp('templates');
  await shot('3-templates');
  const html = frame ? await frame.content() : '';
  log('templates: page loads', html.includes('Templates') || html.includes('templates'));
  log('templates: empty state OR list', /No templates yet|template/i.test(html));
}

// ── 4. Templates editor (new) ───────────────────────────────────────
{
  console.log('\n— Templates editor —');
  const frame = await gotoApp('templates/new');
  await shot('4-template-editor');
  const html = frame ? await frame.content() : '';
  log('template editor: form fields render', html.includes('Template name'));
  log('template editor: trigger select present', html.includes('Trigger'));
  log('template editor: variable chips present', html.includes('{{title}}'));
  log('template editor: live preview shows placeholder', html.includes('Sample Product'));
}

// ── 5. Settings ─────────────────────────────────────────────────────
{
  console.log('\n— Settings —');
  const frame = await gotoApp('settings');
  await shot('5-settings');
  const html = frame ? await frame.content() : '';
  log('settings: Connection section', html.includes('Zernio connection'));
  log('settings: Defaults section', html.includes('Defaults'));
  log('settings: auto-publish has all 3 toggles',
    html.includes('When a product is created') &&
    html.includes('When a product goes on sale') &&
    html.includes('When a product is back in stock'));
  log('settings: UTM toggle + live preview',
    html.includes('Add UTM tracking') && html.includes('utm_source=zernio'));
  log('settings: timezone select renders', html.includes('Default timezone'));
}

// ── 6. Posts page ───────────────────────────────────────────────────
{
  console.log('\n— Posts —');
  const frame = await gotoApp('posts');
  await shot('6-posts');
  const html = frame ? await frame.content() : '';
  log('posts: filter bar present', html.includes('Status') && html.includes('Trigger'));
  log('posts: empty state OR list', /No posts match|published|scheduled|failed/i.test(html));
}

// ── 7. Compose page (need a real product id) ────────────────────────
{
  console.log('\n— Compose —');
  // Re-visit products to grab a product id from the rendered grid
  const productsFrame = await gotoApp('products');
  const productId = await productsFrame.evaluate(() => {
    // Find the first product card's "Share to social" button click target
    const btns = Array.from(document.querySelectorAll('s-button'));
    const share = btns.find((b) => /share to social/i.test(b.textContent || ''));
    if (!share) return null;
    // Buttons live inside cards; we need the product id from the Compose URL
    // they navigate to. Trigger the click and capture window.location after
    // a tick. Easier: just check the embedded compose page's loader query.
    // Pull product id from the Image component's data — we don't have it
    // exposed, so instead navigate via this button.
    share.click();
    return 'clicked';
  });
  if (productId) {
    await page.waitForTimeout(7000);
    await shot('7-compose');
    const frame = page.frames().find((f) => f.url().includes('shopify.zernio.com'));
    const html = frame ? await frame.content() : '';
    log('compose: caption textarea present', html.includes('Shared across all platforms'));
    log('compose: media section present', html.includes('Images'));
    log('compose: account section present', html.includes('Post to'));
    log('compose: schedule section present', html.includes('When to publish'));
    // Per-platform overrides only show when accounts selected — skip in default state
  } else {
    log('compose: could not navigate from products', false);
  }
}

// ── Summary ─────────────────────────────────────────────────────────
console.log('\n— Summary —');
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length} / ${results.length} passed`);
if (failed.length) {
  console.log('\nFailed:');
  failed.forEach((r) => console.log(`  ❌ ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
}

if (errors.length) {
  console.log('\nPage errors:');
  errors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
}
if (consoleErrors.length) {
  console.log('\nConsole errors (first 5):');
  consoleErrors.slice(0, 5).forEach((e) => console.log(`  ${e}`));
}

writeFileSync('shots/results.json', JSON.stringify({ results, errors, consoleErrors }, null, 2));
console.log('\nScreenshots in ./shots/');

await browser.close();
process.exit(failed.length > 0 ? 1 : 0);
