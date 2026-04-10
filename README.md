# Zernio for Shopify

Open-source Shopify app that lets merchants schedule social media posts for their products across 14+ platforms using the [Zernio API](https://zernio.com).

```
Shopify Admin  -->  This App  -->  Zernio API  -->  Instagram, TikTok, X, LinkedIn, Facebook, YouTube, ...
```

## Features

- **Product browser** - Browse your Shopify catalog and pick products to share
- **Post composer** - Pre-filled captions from product data, image selection, multi-platform scheduling
- **Account selector** - Post to any social accounts connected in your Zernio dashboard
- **Post history** - Track scheduled and published posts with status updates
- **GDPR compliant** - Clean data handling with mandatory compliance webhooks

## Prerequisites

- [Shopify Partner](https://partners.shopify.com/) account with a development store
- [Zernio](https://zernio.com) account with an API key ([get one here](https://zernio.com/dashboard/api-keys))
- Node.js 20.19+ or 22.12+
- PostgreSQL database (e.g. [Neon](https://neon.tech) free tier)

## Quick Start

```bash
# Clone
git clone https://github.com/zernio-dev/zernio-shopify.git
cd zernio-shopify

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your credentials (see Environment Variables below)

# Database
npx prisma db push

# Run (starts Shopify CLI dev server with tunnel)
npm run dev
```

Press **P** to open the app URL. Click **Install** on your development store.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SHOPIFY_API_KEY` | Shopify app API key (from Partner Dashboard) | Yes |
| `SHOPIFY_API_SECRET` | Shopify app secret key | Yes |
| `SCOPES` | Shopify access scopes | Yes (`read_products`) |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `ENCRYPTION_KEY` | 64-char hex string for API key encryption | Yes |
| `SHOP_CUSTOM_DOMAIN` | Custom domain for Shopify Plus stores | No |

Generate an encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Tech Stack

- **Framework:** [React Router v7](https://reactrouter.com/) (Shopify's official template)
- **UI:** [Polaris Web Components](https://shopify.dev/docs/api/app-home/using-polaris-components)
- **Database:** PostgreSQL with [Prisma](https://www.prisma.io/)
- **Auth:** [Shopify App Bridge](https://shopify.dev/docs/apps/tools/app-bridge) + session tokens
- **API:** [Zernio REST API](https://docs.zernio.com)

## Project Structure

```
app/
  lib/
    zernio-client.ts           # Typed Zernio API client
    shopify-products.server.ts  # Shopify GraphQL product queries
    encryption.server.ts        # AES-256-GCM encryption for API keys
  routes/
    app.tsx                     # App layout with navigation
    app._index.tsx              # Onboarding flow / dashboard
    app.products.tsx            # Product browser
    app.compose.tsx             # Post composer
    app.posts.tsx               # Post history
    app.settings.tsx            # API key and preferences
    webhooks.*.tsx              # Shopify webhook handlers
  shopify.server.ts             # Shopify app configuration
  db.server.ts                  # Prisma client
prisma/
  schema.prisma                 # Database schema
```

## How It Works

1. Merchant installs the app and enters their Zernio API key
2. The app fetches products from the Shopify store via GraphQL Admin API
3. Merchant selects a product and composes a social media post
4. The app sends the post to Zernio's API with product metadata
5. Zernio handles publishing to the selected social platforms
6. Post status is tracked locally and updated via webhooks

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Add a PostgreSQL database via [Neon integration](https://vercel.com/integrations/neon)
4. Set environment variables
5. Deploy
6. Update `application_url` in `shopify.app.toml` and run `shopify app deploy`

### Docker

```bash
docker build -t zernio-shopify .
docker run -p 3000:3000 --env-file .env zernio-shopify
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

## Links

- [Zernio](https://zernio.com) - Social media scheduling API
- [Zernio API Docs](https://docs.zernio.com) - Full API reference
- [Shopify App Development](https://shopify.dev/docs/apps) - Shopify developer docs
