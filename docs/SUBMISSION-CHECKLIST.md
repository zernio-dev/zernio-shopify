# App Store Submission Checklist

Everything required to submit this app for Shopify App Store review. Code-level work is done; this file tracks the remaining operational and creative tasks.

## Done ✓

- [x] Embedded app using App Bridge + Polaris web components
- [x] Session tokens (no cookies) — via `@shopify/shopify-app-react-router`
- [x] GraphQL Admin API only (no REST)
- [x] Mandatory GDPR webhooks implemented (`customers/data_request`, `customers/redact`, `shop/redact`)
- [x] `shop/redact` cascade-deletes all shop data (validated shop format required)
- [x] App uninstalled webhook cleans up sessions
- [x] Scopes declared in `shopify.app.toml`: `read_products`, `read_inventory`
- [x] Webhook subscriptions declared + HMAC-validated by `authenticate.webhook()`
- [x] Free pricing — no billing surface
- [x] Production deployment at `shopify.zernio.com` (Vercel)
- [x] Custom domain + proper CSP via `@shopify/shopify-app-react-router`
- [x] Public-facing landing page with FAQ at `shopify.zernio.com/`
- [x] Repo public, MIT licensed
- [x] README + CONTRIBUTING in the repo
- [x] Listing copy drafted (`docs/APP-STORE-LISTING.md`)
- [x] Privacy policy drafted (`docs/PRIVACY-POLICY.md`)

## You need to do ✗

### Hosting / ops

- [ ] **Host the privacy policy at a public URL** — suggest `zernio.com/shopify/privacy` or `shopify.zernio.com/privacy`. Just serve the contents of `docs/PRIVACY-POLICY.md` as HTML. Reviewer will check the URL opens.
- [ ] **Confirm support email is monitored** — `support@zernio.com` is referenced throughout. If that inbox isn't already staffed, create a Crisp / helpdesk rule to route it or change to a dedicated alias.
- [ ] **Create a reviewer-only Zernio account** and generate a test API key (`sk_test_...`) for them. Include it in the submission form's notes field.

### Creative assets

- [ ] **App icon** — 1200×1200 PNG, transparent background.
  Source: `public/brand/icon-primary.svg` (coral "Z" on white) rendered at 1200×1200.
- [ ] **Screenshots** — 3 to 5 at 1600×900 (or 1920×1080). Suggested flows:
  1. Home dashboard with the 3 stat cards + recent posts
  2. Products grid with a multi-select selection showing the bulk-action banner
  3. Composer with per-platform tabs + char-count badges
  4. Bulk schedule preview timeline
  5. Settings with auto-publish triggers + UTM toggle live example
- [ ] **Demo video** — ≤5 minutes, English voiceover.
  Suggested flow (shoot in order):
  1. (0:00-0:20) Landing page at `shopify.zernio.com` — explain the value
  2. (0:20-0:45) Install on a dev store → onboarding screen → paste Zernio API key → dashboard
  3. (0:45-1:30) Browse products → click Share → show composer with per-platform tabs → schedule
  4. (1:30-2:30) Templates → create one with `{{title}}` / `{{price}}` variables → show auto-publish toggle in Settings
  5. (2:30-3:30) Bulk schedule — select 2-3 products → cadence 1/hour → preview → create
  6. (3:30-4:30) Post history → filter → inline expand for details
  7. (4:30-5:00) Uninstall mention → privacy note → open-source CTA

### Submission form (shopify.dev/apps/zernio dashboard)

- [ ] App icon uploaded
- [ ] Tagline pasted (from `docs/APP-STORE-LISTING.md`)
- [ ] Short description pasted
- [ ] Long description pasted
- [ ] Features list pasted
- [ ] Keywords pasted
- [ ] Category: Marketing and conversion → Social media
- [ ] Pricing: Free
- [ ] Privacy policy URL
- [ ] Support email
- [ ] Demo URL: `https://shopify.zernio.com`
- [ ] Demo video URL (Loom, YouTube, or Vimeo unlisted)
- [ ] Screenshots uploaded
- [ ] Test credentials in reviewer notes
- [ ] Submission narrative pasted into reviewer notes

### Post-submission

- [ ] Monitor the review status in Partner Dashboard — first review typically takes 5-10 business days
- [ ] Be ready to respond to reviewer feedback within 24 hours (they time out submissions)
- [ ] Once approved, announce on zernio.com, Twitter, and changelog

## Known limitations to mention in submission notes

- The back-in-stock trigger requires `read_inventory`, which we added. Existing installs get prompted to reauthorize via the standard `scopes_update` flow — this is documented behavior, not a bug.
- Zernio handles all actual social posting; we are the bridge. Reviewers should not need to test that social posts actually appear — the test plan should focus on the flow through our app (compose, schedule, bulk, templates, auto-publish gating). Far-future `scheduledFor` keeps test posts from publishing for real.

## One-line summary for the review team

> Thin, free, open-source Shopify app that bridges the product catalog to Zernio's social APIs. Manual compose + bulk schedule + template-gated auto-publish on new product / price drop / back-in-stock, with per-platform caption and media overrides.
