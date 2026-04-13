# Privacy Policy — Zernio for Shopify

_Last updated: 2026-04-13._

This policy describes what data the **Zernio for Shopify** app (the "App") collects from your Shopify store, how it's used, and how you can delete it. It covers only what this app does; Zernio's main platform policy applies to the social posting side and is available at [zernio.com/privacy-policy](https://zernio.com/privacy-policy).

## Who is the data controller

The App is operated by **Zernio** (operator of [zernio.com](https://zernio.com)). Questions: [support@zernio.com](mailto:support@zernio.com).

## What we collect

The App is **deliberately narrow**. When you install it, we store only the following for your shop:

| What | Why | Retention |
|---|---|---|
| Your Shopify shop domain (`yourstore.myshopify.com`) | Identify your install | Until uninstall + 48 h |
| Your Zernio API key, **encrypted at rest** (AES-256-GCM) | Authenticate API calls on your behalf | Until uninstall + 48 h |
| Your default Zernio profile ID and timezone | Compose and schedule posts correctly | Until uninstall + 48 h |
| Your saved post templates | Auto-publish and compose quick-starts | Until uninstall + 48 h |
| A log of each post the App creates (status, trigger, platforms, timestamps) | Show post history; fulfill status webhooks | Until uninstall + 48 h |
| Inventory snapshots per variant (current `available` count) | Detect back-in-stock transitions for the auto-publish trigger | Until uninstall + 48 h |
| Shopify session tokens (offline) | Maintain authenticated admin access | Deleted immediately on uninstall |

**We do NOT collect, store, or process:**

- Any customer personally identifiable information (name, email, address, phone, orders, payments)
- Any marketing lists
- Any product inventory data beyond the `available` count needed for the back-in-stock trigger
- Any analytics, tracking cookies, or third-party telemetry

## What happens to your data after you uninstall

- **Immediately on uninstall** — your Shopify session is removed (you lose admin access through the App).
- **~48 hours after uninstall** — Shopify fires the `shop/redact` compliance webhook. On receipt, the App deletes:
  - Your `ShopConfig` row (including the encrypted API key)
  - Every `PostLog` row for your shop
  - Every `PostTemplate` you created
  - Every `InventorySnapshot` for your shop
  - Any lingering Session rows

Deletions are cascade-enforced at the database level.

## Customer data webhooks

The App handles Shopify's three mandatory data compliance webhooks:

- `customers/data_request` — no-op. The App stores no customer PII, so there is nothing to return.
- `customers/redact` — no-op for the same reason.
- `shop/redact` — full cascade delete of your shop's App data as described above.

Each webhook validates the incoming shop string against the canonical `myshopify.com` format before running any delete, and returns HTTP 200 in all cases per Shopify's requirements.

## Third parties

The App transmits your shop domain, post content, media URLs, and platform/account selections to **Zernio** ([zernio.com](https://zernio.com)) in order to create and schedule posts. This happens through authenticated HTTPS calls using the API key you provided. See Zernio's platform privacy policy for how Zernio handles that data.

The App does not share your data with any other third party.

## Cookies

The App uses only Shopify's session cookies required for the embedded admin experience. No tracking, no analytics, no advertising cookies.

## Security

- Zernio API keys are encrypted at rest using **AES-256-GCM** with an app-level key held in the hosting environment's encrypted secrets store.
- All network traffic uses TLS 1.2+.
- The App is open-source; the full data model and handling logic is auditable at [github.com/zernio-dev/zernio-shopify](https://github.com/zernio-dev/zernio-shopify).

## Your rights

As the merchant operator of your shop, you can at any time:

- **Rotate your Zernio API key** in Settings → Zernio connection → Replace API key. The App re-encrypts and stores the new key; the old one is overwritten.
- **Disconnect Zernio** — rotate the API key to an invalid value, or uninstall the App entirely.
- **Request deletion** — uninstall the App. The `shop/redact` webhook will trigger full deletion within ~48 hours, per Shopify's compliance framework.
- **Access your data** — email [support@zernio.com](mailto:support@zernio.com); we will send the full contents of your `ShopConfig` + related rows within 30 days.

If you are an EU / UK / California resident you also have the right to lodge a complaint with your data protection authority.

## Sub-processors

| Provider | Purpose | Location |
|---|---|---|
| Vercel | App hosting | Global edge; primary region us-east-1 |
| Neon | PostgreSQL database (encrypted API keys, post logs) | us-east-1 |
| Shopify | OAuth, webhooks, product/inventory data fetch | Global |
| Zernio | Social posting infrastructure | See [zernio.com/privacy-policy](https://zernio.com/privacy-policy) |

## Changes to this policy

We will announce material changes via the App's Settings page and update the "Last updated" date above. Continued use of the App after an update constitutes acceptance of the revised policy.

## Contact

[support@zernio.com](mailto:support@zernio.com)
