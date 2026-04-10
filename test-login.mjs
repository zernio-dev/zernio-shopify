import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: undefined,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://admin.shopify.com/store/zernio-dev-testing');
  console.log('Browser opened. Log in to Shopify.');
  console.log('Once you see the admin dashboard, press Enter here...');

  process.stdin.resume();
  await new Promise(resolve => process.stdin.once('data', resolve));

  await context.storageState({ path: 'auth.json' });
  console.log('Saved to auth.json');
  await browser.close();
  process.exit(0);
})();
