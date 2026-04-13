# App Store Listing — Zernio for Shopify

Ready-to-paste copy for the Shopify App Store submission form. Everything here is ≤ Shopify's character limits.

## App name

**Zernio — Social Posts for Products**

(Falls back to just `Zernio` if 30 chars is the hard limit on some fields.)

## Tagline (100 chars)

> Turn products into scheduled posts on 13 social platforms. Free, open source, built on Zernio's social APIs.

Alt options:

> Post your Shopify products to Instagram, TikTok, X, LinkedIn & 9 more — scheduled and automated.
>
> One catalog, 13 social platforms. Schedule, auto-publish, and track posts from your Shopify admin.

## Short description (under 500 chars)

> Zernio for Shopify turns your products into social media posts across 13 platforms — Instagram, TikTok, X, Facebook, LinkedIn, YouTube, Threads, Pinterest, Bluesky, Reddit, Telegram, Google Business, and Snapchat. Browse products, compose posts with per-platform captions and images, bulk-schedule catalogs, or set up templates that auto-publish on new products, price drops, and back-in-stock. Free, open source, built on Zernio's social APIs.

## Feature bullets

- **Post to 13 platforms from one composer.** Shared caption + optional per-platform overrides, with live character counts.
- **Bulk-schedule your catalog.** Multi-select products, pick a cadence (every 15 min to 1/day), preview the timeline, publish.
- **Auto-publish on product events.** New product / price drop / back-in-stock triggers, scoped to templates you control — never fans out to every account by accident.
- **Template-driven captions.** Mustache variables (`{{title}}`, `{{price}}`, `{{url}}`, `{{description}}`) + per-template accounts and scheduling.
- **UTM tracking built in.** One toggle appends `utm_source=zernio&utm_medium=social&utm_campaign=<platform>` to every storefront URL in your posts.
- **Live post history.** Filter by status, trigger, platform, or date. Per-platform status dots. Deep links into Zernio and Shopify.
- **Shop-timezone aware.** Auto-detects your store's IANA timezone on first run.
- **Free. Open source. Privacy-first.** MIT licensed, no install fee, no per-post charge, no customer data stored, encrypted API keys.

## Long description

> **Sell on Shopify. Post everywhere else.**
>
> Zernio for Shopify is the Shopify-native way to turn your product catalog into scheduled social media posts. Browse a product, click Share, pick platforms, write or generate a caption, hit schedule. Or set up a Template and let new products post themselves the moment they go live.
>
> ### Everything you can do
>
> **Per-product composer**
> - Browse your catalog with a count of how many posts each product already has
> - Pre-filled caption from product data, editable
> - Multi-image selection from product media
> - Pick any accounts connected in your Zernio profile
> - Override the caption and images per platform — different copy for X vs LinkedIn vs Instagram, with character limits enforced visually
> - Schedule for any date/time in your shop's timezone, or publish immediately
>
> **Bulk scheduling**
> - Multi-select from the product grid
> - Pick a template + cadence (1 per 15 min / 30 min / hour / 4 hr / 12 hr / 24 hr)
> - Preview the full timeline before committing
> - Progress counter shows posts as they're created
>
> **Templates**
> - Reusable caption formats with mustache variables: `{{title}}`, `{{price}}`, `{{url}}`, `{{description}}`
> - Scoped to specific platforms and accounts
> - Optional scheduling delay or fixed time-of-day for auto-publish
>
> **Auto-publish triggers**
> Enable in Settings, create a Template with target accounts, and Shopify product events drive the posting:
> - **New product** — fires on `products/create`, skips drafts
> - **Price drop** — fires when `compare_at_price > price`, deduped 1 hour per product
> - **Back in stock** — fires when any variant goes from 0 to any positive count, deduped 24 hours
>
> Safety net: triggers only fire if a template is configured. No configuration = no accidental broadcast.
>
> **UTM tracking**
> Toggle on in Settings. Every storefront URL in post content gets `utm_source=zernio&utm_medium=social&utm_campaign=<platform>` appended automatically.
>
> **Post history**
> Every send logged with status, trigger type, and per-platform result. Filter by status, trigger, platform, or date range. Deep link into Zernio to see the live post, or retry if it failed.
>
> ### Requirements
>
> You need a free [Zernio](https://zernio.com) account + API key. Zernio is the social APIs platform (publishing, inbox, analytics, webhooks) that actually talks to the 13 social networks — this app is the Shopify-native layer that makes it effortless to use with your products. Zernio's pricing is usage-based from $1 per connected account; this Shopify app itself is 100% free.
>
> ### Privacy
>
> Your Zernio API key is encrypted at rest (AES-256-GCM). We don't store any customer PII — only your shop's API key, templates, and a log of your own posts. All mandatory GDPR webhooks are implemented, and `shop/redact` fully deletes everything 48 hours after uninstall.
>
> ### Open source
>
> Repo at [github.com/zernio-dev/zernio-shopify](https://github.com/zernio-dev/zernio-shopify). MIT. PRs welcome. Self-hostable if you'd rather not use our deployment.

## Keywords (comma-separated)

> social media, scheduling, instagram, tiktok, twitter, x, facebook, linkedin, youtube, pinterest, threads, bluesky, reddit, telegram, google business, snapchat, auto-post, product marketing, catalog, bulk schedule, zernio, social scheduler, content automation, cross-posting, open source

## Categories

**Primary:** Marketing and conversion → Social media
**Secondary (optional):** Marketing and conversion → Content marketing

## Pricing model

**Free** — no install fee, no subscription, no per-post charge. Users pay Zernio separately for their social posting plan (usage-based, $1 per connected account + tiered volume).

## App Store submission narrative (paste into "Notes to reviewer")

> ### What to test
>
> 1. Install the app on a dev store → the onboarding screen asks for a Zernio API key.
> 2. Use the test Zernio key provided below → connects, shows dashboard.
> 3. Browse products → grid renders with a per-product post-count badge.
> 4. Click **Share to social** on any product → composer loads with pre-filled caption, product images, and account checkboxes.
> 5. Select one account, toggle off **Publish immediately**, pick a future datetime, click **Schedule post** → success banner, post appears under Posts with status "scheduled".
> 6. Go to **Templates** → **New template** → create one with trigger "Manual" and content `Try {{title}} for {{price}}`. Save. Return to composer → template dropdown shows it as quick-start.
> 7. In **Settings** toggle UTM on → the live example updates with `utm_source=zernio`.
> 8. From **Products**, check two products, click **Bulk schedule** → pick cadence, see the preview timeline, click create → both posts appear in history with staggered times.
>
> ### Test credentials
>
> Zernio API key (reviewer-only, Professional plan):
> `sk_18deb85a0b1d331bcfed7f6c8934177dd6f73d5ea5d1dadb506425f9604071d9`
>
> Tied to demo@zernio.com which has 5 active social accounts already
> connected under a "Demo Profile": Facebook, Instagram, TikTok,
> Twitter/X, YouTube. That profile is set as default so no additional
> setup is required before testing.
>
> ### Scopes
>
> - `read_products` — to fetch product data for the composer and auto-publish triggers
> - `read_inventory` — to detect 0 → positive transitions for the back-in-stock trigger
>
> We don't write to Shopify — only read.
>
> ### Webhooks subscribed
>
> - `app/uninstalled`, `app/scopes_update` — session/scope lifecycle
> - `products/create`, `products/update`, `products/delete` — auto-publish triggers
> - `inventory_levels/update` — back-in-stock detection
> - `customers/data_request`, `customers/redact`, `shop/redact` — mandatory GDPR
>
> All GDPR handlers validate the incoming shop string before doing any delete (see `app/routes/webhooks.compliance.tsx` for the `isValidShop` guard).

## What you still need to provide

- [ ] **Icon** — 1200×1200 PNG, transparent background. Can reuse `public/brand/icon-primary.svg` (coral `Z` on white) rendered at 1200×1200.
- [ ] **Screenshots** (3-5, 1600×900 or 1920×1080)
  - Suggested: Home dashboard / Products grid / Composer with per-platform tabs / Bulk schedule preview / Settings with auto-publish toggles
- [ ] **Demo video** (≤5 min, English voiceover)
  - Flow: install → connect API key → browse products → compose → schedule → show post in history → optionally a bulk schedule demo
- [ ] **Privacy policy URL** — see `docs/PRIVACY-POLICY.md` for ready-to-host copy. Needs to live at a publicly-reachable URL (suggested: `zernio.com/shopify/privacy`).
- [ ] **Support email** — suggested `support@zernio.com` if not already monitored, or a Shopify-specific alias.
- [ ] **Test Zernio API key** — create a reviewer-only Zernio account with a few low-stakes social accounts connected, paste the `sk_test_...` key into the submission narrative above.
