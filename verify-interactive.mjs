/**
 * Interactive verification — exercises the new Phase 2 flows end-to-end:
 *   1. Create a template, list it, delete it
 *   2. Toggle UTM and verify the live example updates in real time
 *   3. Multi-select products and load the bulk-schedule preview
 *   4. Open a compose page and verify per-platform overrides UI appears
 *      after selecting an account
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const STORE = 'zernio-dev-testing';
const BASE = `https://admin.shopify.com/store/${STORE}/apps/zernio`;
const TEMPLATE_NAME = `Phase2 verify ${Date.now()}`;

mkdirSync('shots', { recursive: true });
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({
  storageState: 'auth.json',
  viewport: { width: 1440, height: 1100 },
});
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200));
});

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function go(path) {
  await page.goto(`${BASE}/app/${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  return page.frames().find((f) => f.url().includes('shopify.zernio.com'));
}

async function shot(name) {
  await page.screenshot({ path: `shots/i-${name}.png`, fullPage: true });
}

// ── 1. Template CRUD ────────────────────────────────────────────────
{
  console.log('\n— Template CRUD —');
  let f = await go('templates/new');
  await shot('1a-template-editor');

  // Fill the form via setting the s-text-field value programmatically
  // (web components don't always respect Playwright's .fill())
  await f.evaluate((name) => {
    const setVal = (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const nameField = document.querySelector('s-text-field');
    if (nameField) setVal(nameField, name);
    const ta = document.querySelector('s-text-area');
    if (ta) setVal(ta, 'Now in stock: {{title}} for ${{price}} → {{url}}');
  }, TEMPLATE_NAME);
  await page.waitForTimeout(500);

  // Click Save
  const saved = await f.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('s-button'));
    const save = btns.find((b) => /save template/i.test(b.textContent || ''));
    if (!save) return false;
    save.click();
    return true;
  });
  record('template: save button found and clicked', saved);
  await page.waitForTimeout(5000);

  // Should now be on /app/templates with our template visible
  f = page.frames().find((x) => x.url().includes('shopify.zernio.com'));
  await shot('1b-template-saved');
  let html = f ? await f.content() : '';
  record('template: appears in list after save', html.includes(TEMPLATE_NAME));

  // Re-open the template by clicking it
  const opened = await f.evaluate((name) => {
    const cards = Array.from(document.querySelectorAll('s-clickable'));
    const target = cards.find((c) => (c.textContent || '').includes(name));
    if (!target) return false;
    target.click();
    return true;
  }, TEMPLATE_NAME);
  record('template: card is clickable', opened);
  await page.waitForTimeout(4000);

  // Delete it via the danger zone button
  f = page.frames().find((x) => x.url().includes('shopify.zernio.com'));
  // Auto-confirm the window.confirm dialog
  page.on('dialog', (d) => d.accept());
  const deleted = await f.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('s-button'));
    const del = btns.find((b) => /delete template/i.test(b.textContent || ''));
    if (!del) return false;
    del.click();
    return true;
  });
  record('template: delete button works', deleted);
  await page.waitForTimeout(5000);

  // Should be back on list, template gone
  f = page.frames().find((x) => x.url().includes('shopify.zernio.com'));
  html = f ? await f.content() : '';
  record('template: removed after delete', !html.includes(TEMPLATE_NAME));
  await shot('1c-template-deleted');
}

// ── 2. UTM live example ─────────────────────────────────────────────
{
  console.log('\n— UTM live example —');
  const f = await go('settings');
  await shot('2-settings-utm-off');

  // Find the UTM checkbox and click it
  const toggled = await f.evaluate(() => {
    const cbs = Array.from(document.querySelectorAll('s-checkbox'));
    const utm = cbs.find((c) =>
      /add utm tracking/i.test(c.getAttribute('label') || ''),
    );
    if (!utm) return false;
    utm.click();
    return true;
  });
  record('settings: UTM toggle is clickable', toggled);
  await page.waitForTimeout(700);

  await shot('2b-settings-utm-on');
  const html = await f.content();
  record(
    'settings: live example updates with UTM params on toggle',
    html.includes('utm_source=zernio'),
  );
}

// ── 3. Bulk select & preview ────────────────────────────────────────
{
  console.log('\n— Bulk select & preview —');
  let f = await go('products');
  await shot('3a-products-grid');

  // Click checkboxes on the first 2 product cards
  const selected = await f.evaluate(() => {
    const cbs = Array.from(document.querySelectorAll('s-checkbox'));
    // Skip the first checkbox (select-all) and click the next 2
    const productCbs = cbs.filter(
      (c) => !/select all/i.test(c.getAttribute('label') || ''),
    );
    let n = 0;
    for (const c of productCbs.slice(0, 2)) {
      c.click();
      n++;
    }
    return n;
  });
  record('products: clicked product checkboxes', selected === 2);
  await page.waitForTimeout(500);
  await shot('3b-products-selected');

  // Sticky banner should appear
  const html = await f.content();
  record(
    'products: bulk-action banner shows count',
    /\d+ products? selected/i.test(html),
  );

  // Click the bulk-schedule button
  const bulkClicked = await f.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('s-button'));
    const bulk = btns.find((b) => /bulk schedule/i.test(b.textContent || ''));
    if (!bulk) return false;
    bulk.click();
    return true;
  });
  record('products: bulk-schedule CTA clickable', bulkClicked);
  await page.waitForTimeout(6000);

  f = page.frames().find((x) => x.url().includes('shopify.zernio.com'));
  await shot('3c-bulk-schedule');
  const bulkHtml = f ? await f.content() : '';
  record('bulk: timeline preview rendered', /Preview/.test(bulkHtml));
  record('bulk: cadence picker present', /Posting frequency/i.test(bulkHtml));
}

// ── 4. Compose with per-platform tabs ───────────────────────────────
{
  console.log('\n— Compose per-platform overrides —');
  let f = await go('products');
  // Click first "Share to social"
  await f.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('s-button'));
    const share = btns.find((b) => /share to social/i.test(b.textContent || ''));
    if (share) share.click();
  });
  await page.waitForTimeout(7000);
  f = page.frames().find((x) => x.url().includes('shopify.zernio.com'));
  await shot('4a-compose');

  // Select the first account
  const accSelected = await f.evaluate(() => {
    const cbs = Array.from(document.querySelectorAll('s-checkbox'));
    // Find the first account checkbox (label includes "@")
    const acc = cbs.find((c) => /@/.test(c.getAttribute('label') || ''));
    if (!acc) return false;
    acc.click();
    return true;
  });
  record('compose: account checkbox clickable', accSelected);
  await page.waitForTimeout(800);

  await shot('4b-compose-with-overrides');
  const html = await f.content();
  record(
    'compose: per-platform override section appears after account select',
    /Customize per platform/i.test(html),
  );
  record(
    'compose: char count badge rendered',
    /\d+\s*\/\s*\d+/.test(html),
  );
}

// ── Summary ─────────────────────────────────────────────────────────
console.log('\n— Summary —');
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length} / ${results.length} passed`);
if (failed.length) {
  console.log('\nFailed:');
  failed.forEach((r) => console.log('  ❌ ' + r.name));
}
if (errors.length) {
  console.log('\nErrors (first 5):');
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
}

await browser.close();
process.exit(failed.length > 0 ? 1 : 0);
