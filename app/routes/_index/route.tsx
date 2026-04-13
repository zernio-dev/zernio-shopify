import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

// FAQ content — mirrors the structure used on zernio.com/ (dl > dt/dd with
// "└" prefix), answers are Shopify-app-specific.
const FAQS = [
  {
    q: "What does this app actually do?",
    a: "Turns your Shopify products into social media posts across 13 platforms — Instagram, TikTok, X, Facebook, LinkedIn, YouTube, Threads, Pinterest, Bluesky, Reddit, Telegram, Google Business, Snapchat. Browse a product, click Share, pick platforms, schedule. Or set up templates that auto-publish when products change.",
  },
  {
    q: "Do I need a Zernio account?",
    a: "Yes. The app is a bridge between Shopify and Zernio's social posting API. Sign up free at zernio.com, connect your social accounts there, paste your API key into this app, and you're connected. Revenue comes from your Zernio subscription, not from this app.",
  },
  {
    q: "Is the Shopify app really free?",
    a: "Yes — no install fee, no per-post charge, no in-app upsells. You pay Zernio for its social posting plan (usage-based, from $1 per connected account), and this app gives you a Shopify-native way to use it. Open source under MIT on GitHub.",
  },
  {
    q: "Can I schedule posts, or does everything publish immediately?",
    a: "Both. Pick \"Schedule for\" and a date/time in the composer, or toggle \"Publish immediately\". Scheduled posts use your shop's timezone. Auto-publish triggers can also schedule (via a template delay) instead of going out the second the webhook fires.",
  },
  {
    q: "Can I customize the caption per platform?",
    a: "Yes. Write one shared caption, then override it per platform with its own text and images. Character counts per platform (280 for X, 2200 for Instagram, 3000 for LinkedIn, etc.) show a live badge so you never accidentally exceed a limit.",
  },
  {
    q: "Do auto-publish triggers really fire on their own?",
    a: "Only when you tell them to. Flip the toggle in Settings AND create a Template with at least one target account for that trigger type. No template = no post. This is deliberate so you can never accidentally broadcast to every connected account.",
  },
  {
    q: "What about Instagram / Pinterest / TikTok — they need images, right?",
    a: "Right. If a product has no featured image, the auto-publish path silently skips platforms that require media. Manual composer lets you attach multiple images and override per platform. You can't post to TikTok or YouTube without video — that's a platform requirement, not ours.",
  },
  {
    q: "Does the app bulk-schedule?",
    a: "Yes. Multi-select products on the Products page, click Bulk schedule, pick a cadence (1 every 15 min / hour / day, etc.) and a template. The app creates one scheduled Zernio post per product with staggered times so you can space out an entire catalog launch.",
  },
  {
    q: "What data does the app store about my shop?",
    a: "Encrypted Zernio API key (AES-256-GCM), your chosen default profile and timezone, your post templates, and a log of each post (status + platforms + timestamps). No customer data. Everything is deleted when you uninstall — per Shopify's shop/redact requirement.",
  },
  {
    q: "Can I add UTM tracking to the product links?",
    a: "Toggle it on in Settings → Links. Every storefront URL in your post content gets utm_source=zernio, utm_medium=social, and utm_campaign=<platform> appended automatically. Existing query params are preserved.",
  },
  {
    q: "How do I uninstall cleanly?",
    a: "Uninstall from Shopify admin's Apps page. Your session is removed immediately; all your config (templates, history, settings) is deleted when Shopify fires the shop/redact webhook ~48 hours later, per GDPR compliance.",
  },
  {
    q: "I found a bug / want a feature — where do I report it?",
    a: "GitHub Issues at github.com/zernio-dev/zernio-shopify, or email support@zernio.com. Repo is public and MIT licensed, PRs welcome.",
  },
] as const;

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <img src="/brand/logo-primary.svg" alt="Zernio" className={styles.logo} />

        <h1 className={styles.headline}>
          Sell on Shopify.
          <br />
          Post <span className={styles.coral}>everywhere else</span>.
        </h1>

        <p className={styles.sub}>
          Turn Shopify products into scheduled posts on 13 social platforms.
        </p>

        <a
          href="https://admin.shopify.com/oauth/install?client_id=ee20ee832fea8bfbc7fe61e1c960b935"
          className={styles.cta}
        >
          Install on Shopify →
        </a>

        <p className={styles.meta}>
          Free ·{" "}
          <a href="https://github.com/zernio-dev/zernio-shopify">Open source</a> ·{" "}
          <a href="https://docs.zernio.com">Docs</a>
        </p>

        {showForm && (
          <Form className={styles.login} method="post" action="/auth/login">
            <input
              className={styles.loginInput}
              type="text"
              name="shop"
              placeholder="your-store.myshopify.com"
            />
            <button className={styles.loginBtn} type="submit">
              Sign in
            </button>
          </Form>
        )}
      </section>

      {/* FAQ — same "dl > dt/dd with └ prefix" pattern as zernio.com */}
      <section className={styles.faq}>
        <h2 className={styles.faqHeading}>
          <span className={styles.badge}>FAQ</span>
        </h2>
        <dl className={styles.faqList}>
          {FAQS.map((item, i) => (
            <div key={i} className={styles.faqItem}>
              <dt className={styles.faqQ}>{item.q}</dt>
              <dd className={styles.faqA}>
                <span className={styles.faqArrow} aria-hidden="true">└</span>
                <span>{item.a}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className={styles.faqFooter}>
          Still have questions?{" "}
          <a href="mailto:support@zernio.com">Email the team</a>.
        </p>
      </section>
    </main>
  );
}
