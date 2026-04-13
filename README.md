# Zernio for Shopify

Open-source Shopify app that turns your products into scheduled social media posts across 13 platforms — Instagram, TikTok, X, Facebook, LinkedIn, YouTube, Threads, Pinterest, Bluesky, Reddit, Telegram, Google Business, Snapchat — powered by [Zernio's social APIs](https://zernio.com).

```
Shopify Admin  ──▶  This App  ──▶  Zernio API  ──▶  13 social platforms
```

**Live at** [store.zernio.com](https://store.zernio.com) · Free · MIT licensed · No install fee, no per-post charge.

## What it does

**Manual publishing**
- Browse your Shopify catalog with per-product post counts
- One-click "Share to social" → composer with pre-filled caption, images, and platform selector
- **Per-platform overrides** — write one shared caption, override per platform with its own text and images, with live character-count badges (280 for X, 2200 for Instagram, 3000 for LinkedIn, etc.)
- Schedule immediately or at a specific date/time in your shop's timezone

**Bulk scheduling**
- Multi-select products and bulk-schedule with cadence (1 / 15 min / 30 min / 1 hr / 4 hr / 12 hr / 24 hr)
- Preview the full timeline before committing

**Templates**
- Reusable caption templates with mustache variables: `{{title}}`, `{{price}}`, `{{url}}`, `{{description}}`
- Scoped to specific platforms and accounts
- Optional delay or fixed time-of-day for auto-publish scheduling

**Auto-publish triggers** (opt-in, template-gated)
- On product created
- On price drop (`compare_at_price` > `price`, deduped 1 hr per product)
- On back-in-stock (any variant 0 → positive, deduped 24 hr per product)
- **Safety net:** triggers only fire when you've configured a template with at least one target account — no accidental broadcast to every connected account

**UTM tracking**
- One toggle appends `utm_source=zernio&utm_medium=social&utm_campaign=<platform>` to every storefront URL in post content

**Live post history**
- Filters by status, trigger, platform, date range
- Per-platform status dots
- Inline expand with full details, retry CTA, deep link into Zernio

**Compliance**
- AES-256-GCM encryption for stored API keys
- Mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
- `shop/redact` fully cascades through `PostLog`, `PostTemplate`, `InventorySnapshot`

## Prerequisites

- [Shopify Partner](https://partners.shopify.com/) account with a development store
- [Zernio](https://zernio.com) account + API key ([get one](https://zernio.com/dashboard/api-keys))
- Node.js 20.19+ or 22.12+
- PostgreSQL ([Neon](https://neon.tech) free tier works great)

## Quick Start

```bash
git clone https://github.com/zernio-dev/zernio-shopify.git
cd zernio-shopify
npm install

cp .env.example .env
# edit .env (see Environment Variables below)

npx prisma db push       # create tables
npm run dev              # starts Shopify CLI dev server + tunnel
```

Press **P** to open the app URL, click **Install** on your development store, paste your Zernio API key.

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `SHOPIFY_API_KEY` | Shopify app API key (Partner Dashboard) | Yes |
| `SHOPIFY_API_SECRET` | Shopify app secret | Yes |
| `SCOPES` | Shopify access scopes — `read_products,read_inventory` | Yes |
| `SHOPIFY_APP_URL` | Deployed app URL (e.g. `https://store.zernio.com`) | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `ENCRYPTION_KEY` | 64-char hex for API key encryption | Yes |
| `SHOP_CUSTOM_DOMAIN` | Custom domain for Shopify Plus stores | No |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Tech Stack

- **Framework:** [React Router v7](https://reactrouter.com/) (Shopify's official template)
- **UI:** [Polaris Web Components](https://shopify.dev/docs/api/app-home/using-polaris-components) (`<s-page>`, `<s-section>`, `<s-stack>`, `<s-empty-state>`, etc.) — no React Polaris, no custom CSS framework
- **Database:** PostgreSQL via [Prisma](https://www.prisma.io/)
- **Auth:** [Shopify App Bridge](https://shopify.dev/docs/apps/tools/app-bridge) + session tokens
- **Zernio:** thin typed REST client in `app/lib/zernio-client.ts`

## Project Structure

```
app/
  lib/
    auto-post.server.ts         # shared auto-publish flow (products + inventory webhooks)
    encryption.server.ts        # AES-256-GCM
    shopify-products.server.ts  # GraphQL queries
    utm.server.ts               # UTM injection
    zernio-client.ts            # Typed Zernio REST client
  routes/
    app.tsx                     # layout + <s-app-nav>
    app._index.tsx              # dashboard / onboarding
    app.products.tsx            # product grid + multi-select
    app.compose.tsx             # composer with per-platform overrides
    app.posts.tsx               # history + filters + detail
    app.templates._index.tsx    # template list
    app.templates.$id.tsx       # template editor
    app.bulk-schedule.tsx       # bulk scheduling flow
    app.settings.tsx            # connection, defaults, auto-publish, UTM
    api.*.tsx                   # XHR endpoints (create-post, upsert/delete-template, bulk-create-posts, verify-key, update-settings, zernio-webhook)
    webhooks.*.tsx              # Shopify webhooks (products, inventory, compliance, app-uninstalled, scopes-update)
    _index/                     # public landing at store.zernio.com
  shopify.server.ts             # Shopify app config
  db.server.ts                  # Prisma singleton
prisma/
  schema.prisma                 # Session, ShopConfig, PostTemplate, PostLog, InventorySnapshot
shopify.app.toml                # scopes + webhook subscriptions
```

## How It Works

1. Merchant installs → paste Zernio API key → app encrypts and stores
2. App reads Shopify products via Admin GraphQL
3. Merchant composes a post (or sets up a template) → app calls `POST /v1/posts` on Zernio with `metadata: { source: "shopify", productId, shopDomain }`
4. Zernio handles platform publishing and fires back a webhook to `/api/zernio-webhook` so the `PostLog.status` stays current
5. Product lifecycle webhooks (`products/create`, `products/update`, `inventory_levels/update`) trigger the corresponding auto-publish template — **only if a matching active template exists**

## Deployment

### Vercel

1. Import the repo in [Vercel](https://vercel.com)
2. Attach a PostgreSQL database via [Neon integration](https://vercel.com/integrations/neon)
3. Set environment variables
4. Deploy (the build script runs `prisma generate` automatically)
5. Update `application_url` in `shopify.app.toml`
6. `shopify app deploy` to push scopes + webhook subscriptions to Shopify

### Docker

```bash
docker build -t zernio-shopify .
docker run -p 3000:3000 --env-file .env zernio-shopify
```

## Safety notes for contributors

- **Never run auto-post with `publishNow: true` in tests** — it will fan out to every connected account. Use a scoped template with `autoPublishDelay: 999999` or set `publishNow: false` with a far-future `scheduledFor`.
- **Every `deleteMany` that includes a shop string MUST validate it first.** An unvalidated `where: { shop: undefined }` becomes "delete every row across every shop." See `webhooks.compliance.tsx` for the `isValidShop` pattern.
- **Auto-publish requires a template with non-empty `accountIds`.** The fallback-to-every-account path was removed. New trigger types should follow the same pattern.
- **Polaris web components don't auto-space their children.** Wrap multiple siblings inside `<s-section>` / `<s-banner>` / `<s-empty-state>` in an `<s-stack direction="block" gap="base">` so buttons don't crash into prose.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome — repo is MIT.

## License

[MIT](LICENSE)

## Links

- [Zernio](https://zernio.com) — social APIs for developers
- [Zernio API Docs](https://docs.zernio.com)
- [Shopify App Development](https://shopify.dev/docs/apps)
