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

// Repeated twice for a seamless CSS marquee loop.
const PLATFORMS = [
  "Instagram", "TikTok", "X", "Facebook", "LinkedIn", "YouTube",
  "Threads", "Pinterest", "Bluesky", "Reddit", "Telegram",
  "Google Business", "Snapchat",
] as const;

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <main className={styles.page}>
      {/* Tiny brand mark — the only chrome on the page */}
      <a href="https://zernio.com" className={styles.mark} aria-label="Zernio">
        <img src="/brand/icon-primary.svg" alt="" />
      </a>

      {/* Top-right: minimal utility links, no full header */}
      <div className={styles.corner}>
        <a href="https://docs.zernio.com">docs</a>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/zernio-dev/zernio-shopify">github</a>
      </div>

      {/* The statement — the whole page is this */}
      <section className={styles.statement}>
        <h1 className={styles.headline}>
          <span className={styles.line}>Sell on</span>
          <span className={styles.lineShopify}>
            <svg
              className={styles.inlineShopify}
              viewBox="0 0 109.5 124.5"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path d="M95.6 28.2c-.1-.6-.6-1-1.1-1-.5 0-10.3-1.8-10.3-1.8s-6.8-6.8-7.5-7.5c-.7-.7-2.1-.5-2.6-.3 0 0-1.4.4-3.6 1.1-.4-1.2-.9-2.6-1.7-4.1-2.5-4.8-6.1-7.3-10.5-7.3h-.3c-1.5-1.9-3.4-2.7-5-2.7-12.4.4-18.3 15.5-20.2 23.4-4.8 1.5-8.2 2.5-8.6 2.7-2.7.8-2.8.9-3.1 3.5-.3 1.9-7.3 56.2-7.3 56.2l54.8 10.3 29.7-6.4S95.7 28.8 95.6 28.2zM67.3 21.4l-5.7 1.8c0-3-.4-7.4-1.7-11.1 4.3.8 6.4 5.6 7.4 9.3zm-9.7 3l-12.3 3.8c1.2-4.6 3.5-9.2 6.3-12.2 1.1-1.1 2.5-2.3 4.2-3 1.7 3.5 1.8 8.5 1.8 11.4zm-8-16.9c1.4 0 2.5.5 3.5 1.4-4 1.9-8.2 6.7-10 16.3l-9.7 3c2.1-9.2 7.8-20.7 16.2-20.7z" fill="#95BF47"/>
              <path d="M94.5 27.2c-.5 0-10.3-1.8-10.3-1.8s-6.8-6.8-7.5-7.5c-.3-.3-.6-.4-1-.5l-4.1 100.5 29.7-6.4s-6-41.2-6.1-42.3c-.1-1.4-.3-1.9-.7-41z" fill="#5E8E3E"/>
              <path d="M60.7 43.9l-3.7 10.9s-3.3-1.8-7.3-1.8c-5.9 0-6.2 3.7-6.2 4.6 0 5.1 13.3 7 13.3 19 0 9.4-6 15.5-14 15.5-9.6 0-14.5-6-14.5-6l2.6-8.5s5.1 4.4 9.3 4.4c2.8 0 3.9-2.2 3.9-3.8 0-6.6-10.9-6.9-10.9-17.9 0-9.2 6.6-18.1 20-18.1 5.1.1 7.5 1.7 7.5 1.7z" fill="#FFFFFF"/>
            </svg>
            Shopify.
          </span>
          <span className={styles.lineShout}>
            <span className={styles.shoutWord} data-text="Shout">Shout</span>
          </span>
          <span className={styles.line}>on everywhere else.</span>
        </h1>

        <div className={styles.actions}>
          <a
            href="https://admin.shopify.com/oauth/install?client_id=ee20ee832fea8bfbc7fe61e1c960b935"
            className={styles.cta}
          >
            <span>Install the app</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
          <span className={styles.meta}>free · open source · MIT</span>
        </div>
      </section>

      {/* Platform ribbon — continuous horizontal scroll */}
      <div className={styles.ribbon} aria-hidden="true">
        <div className={styles.ribbonTrack}>
          {[...PLATFORMS, ...PLATFORMS].map((p, i) => (
            <span key={i} className={styles.platform}>
              <span className={styles.platformDot} />
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* Unobtrusive existing-install login */}
      {showForm && (
        <Form className={styles.login} method="post" action="/auth/login">
          <input
            className={styles.loginInput}
            type="text"
            name="shop"
            placeholder="your-store.myshopify.com"
            aria-label="Shop domain"
          />
          <button className={styles.loginBtn} type="submit">sign in →</button>
        </Form>
      )}
    </main>
  );
}
