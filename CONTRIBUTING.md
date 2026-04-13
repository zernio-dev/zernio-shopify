# Contributing to Zernio Shopify

Thanks for your interest in contributing! This is an open-source Shopify app that connects Shopify product catalogs to [Zernio's social APIs](https://zernio.com).

## Development Setup

### Prerequisites

- Node.js 20.19+ or 22.12+
- A [Shopify Partner](https://partners.shopify.com/) account with a development store
- A [Zernio](https://zernio.com) account with an API key
- PostgreSQL database (or use [Neon](https://neon.tech) free tier)

### Getting Started

1. Fork and clone the repo
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in the values
4. Set up the database: `npx prisma db push`
5. Start development: `npm run dev` (uses Shopify CLI with tunnel)

### Branch Naming

- `feat/description` for new features
- `fix/description` for bug fixes
- `docs/description` for documentation changes

### Pull Requests

- Write a clear description of what changed and why
- Include screenshots for UI changes
- Make sure `npm run typecheck` passes
- Follow existing code patterns and conventions

## Architecture

```
Shopify Admin (iframe)
    |
    v
This App (React Router v7 + Polaris Web Components)
    |
    v
Zernio REST API (https://zernio.com/api/v1)
    |
    v
14+ Social Media Platforms
```

The app is a thin bridge. It does NOT duplicate any scheduling or publishing logic. All social media operations are delegated to the Zernio API.

## Code Style

- TypeScript strict mode
- Follow the patterns in the Shopify app template
- Use Polaris Web Components (`<s-page>`, `<s-section>`, etc.) for UI
- Server-side logic in route `loader` and `action` functions
- Zernio API calls go through `app/lib/zernio-client.ts`

## License

MIT
