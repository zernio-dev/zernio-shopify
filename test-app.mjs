import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: 'auth.json' });
  const page = await context.newPage();

  async function getAppFrame(waitMs = 5000) {
    await page.waitForTimeout(waitMs);
    for (const frame of page.frames()) {
      if (frame.url().includes('trycloudflare') || frame.url().includes('zernio-shopify')) {
        return frame;
      }
    }
    return null;
  }

  async function shot(name) {
    try {
      const frame = await getAppFrame(1000);
      if (frame) {
        const buf = await frame.locator('body').screenshot();
        fs.writeFileSync(name, buf);
      } else {
        await page.screenshot({ path: name, fullPage: true });
      }
    } catch {
      await page.screenshot({ path: name, fullPage: true });
    }
    console.log(`  Screenshot: ${name}`);
  }

  // TEST: Dashboard -> Click Browse products
  console.log('\n=== TEST: Dashboard -> Browse products ===');
  await page.goto('https://admin.shopify.com/store/zernio-dev-testing/apps/zernio');
  let frame = await getAppFrame();
  if (!frame) { console.log('FAIL: No app frame'); await browser.close(); return; }

  console.log('  Page URL before:', page.url());

  const btn = frame.locator('button:has-text("Browse products")');
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForTimeout(6000);
    console.log('  Page URL after:', page.url());

    frame = await getAppFrame(1000);
    if (frame) {
      const text = await frame.textContent('body').catch(() => '');
      await shot('test-browse.png');
      if (text.includes('Share to social') || text.includes('Search')) {
        console.log('  PASS: Products page');
      } else if (text.includes('Browse products')) {
        console.log('  FAIL: Still dashboard');
      } else {
        console.log('  Content:', text.substring(0, 150));
      }
    } else {
      console.log('  No frame after click - page may have reloaded');
      await page.screenshot({ path: 'test-browse.png', fullPage: true });
    }
  }

  // TEST: Products -> Share to social
  console.log('\n=== TEST: Products -> Share to social ===');
  await page.goto('https://admin.shopify.com/store/zernio-dev-testing/apps/zernio/products');
  frame = await getAppFrame(6000);
  if (frame) {
    await shot('test-products-page.png');
    const shareBtn = frame.locator('button:has-text("Share to social")').first();
    if (await shareBtn.count() > 0) {
      console.log('  Found Share to social button, clicking...');
      await shareBtn.click();
      await page.waitForTimeout(6000);
      console.log('  Page URL after:', page.url());
      frame = await getAppFrame(1000);
      if (frame) {
        const text = await frame.textContent('body').catch(() => '');
        await shot('test-compose.png');
        if (text.includes('Caption') || text.includes('Post content') || text.includes('Schedule') || text.includes('Post to')) {
          console.log('  PASS: Compose page');
        } else {
          console.log('  Content:', text.substring(0, 200));
        }
      }
    } else {
      console.log('  No Share to social button');
    }
  }

  await browser.close();
  console.log('\n=== DONE ===');
})();
