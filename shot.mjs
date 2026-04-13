import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });

// Desktop hero
const p1 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await p1.goto('https://shopify.zernio.com/', { waitUntil: 'networkidle' });
await p1.waitForTimeout(1000);
await p1.screenshot({ path: 'landing-desktop.png' }); // viewport-only

// Desktop hero + hover state
const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await p2.goto('https://shopify.zernio.com/', { waitUntil: 'networkidle' });
await p2.hover('a[href^="https://admin.shopify.com/oauth/install"]');
await p2.waitForTimeout(400);
await p2.screenshot({ path: 'landing-hover.png' });

// Mobile
const p3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
await p3.goto('https://shopify.zernio.com/', { waitUntil: 'networkidle' });
await p3.waitForTimeout(500);
await p3.screenshot({ path: 'landing-mobile.png', fullPage: true });

await browser.close();
