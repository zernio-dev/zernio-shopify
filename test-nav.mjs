import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: 'auth.json' });
  const page = await context.newPage();

  await page.goto('https://admin.shopify.com/store/zernio-dev-testing/apps/zernio');
  await page.waitForTimeout(5000);

  // Get the app frame
  let frame;
  for (const f of page.frames()) {
    if (f.url().includes('trycloudflare')) { frame = f; break; }
  }
  if (!frame) { console.log('No frame'); await browser.close(); return; }

  // Check what shopify object has
  const result = await frame.evaluate(() => {
    const s = window.shopify;
    if (!s) return 'shopify object not found';
    return {
      keys: Object.keys(s),
      type: typeof s,
      hasNavigate: typeof s.navigate,
      hasRedirect: typeof s.redirect,
      toastType: typeof s.toast,
      idTokenType: typeof s.idToken,
    };
  });
  console.log('Shopify App Bridge object:', JSON.stringify(result, null, 2));

  // Try top-level navigation via the parent window
  console.log('\nTesting navigation via top.location...');
  await frame.evaluate(() => {
    // In Shopify embedded apps, changing top.location navigates the admin
    window.top.location.href = '/store/zernio-dev-testing/apps/zernio/products';
  }).catch(e => console.log('top.location failed (expected):', e.message));

  await page.waitForTimeout(3000);

  // Try App Bridge redirect
  console.log('\nTesting shopify.redirect...');
  await page.goto('https://admin.shopify.com/store/zernio-dev-testing/apps/zernio');
  await page.waitForTimeout(5000);
  frame = null;
  for (const f of page.frames()) {
    if (f.url().includes('trycloudflare')) { frame = f; break; }
  }
  if (frame) {
    const navResult = await frame.evaluate(async () => {
      try {
        // Try various navigation methods
        if (window.shopify?.navigate) {
          window.shopify.navigate('/products');
          return 'shopify.navigate(/products) called';
        }
        return 'no navigate method';
      } catch (e) { return 'error: ' + e.message; }
    });
    console.log('Navigate result:', navResult);
    await page.waitForTimeout(3000);

    // Check current URL
    for (const f of page.frames()) {
      if (f.url().includes('trycloudflare') || f.url().includes('zernio-shopify')) {
        console.log('Frame URL after navigate:', f.url().substring(0, 100));
      }
    }
    console.log('Page URL:', page.url());
  }

  await browser.close();
})();
