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

const PLATFORMS = [
  "Instagram", "TikTok", "X", "Facebook", "LinkedIn",
  "YouTube", "Threads", "Pinterest", "Bluesky", "Reddit",
  "Telegram", "Google Business", "Snapchat",
] as const;

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a href="https://zernio.com" className={styles.brand} aria-label="Zernio">
          {/* Official Zernio wordmark */}
          <img src="/brand/logo-primary.svg" alt="Zernio" className={styles.brandLogo} />
        </a>
        <nav className={styles.nav}>
          <a href="https://zernio.com" className={styles.navLink}>Platform</a>
          <a href="https://docs.zernio.com" className={styles.navLink}>Docs</a>
          <a href="https://github.com/zernio-dev/zernio-shopify" className={styles.navLink}>GitHub</a>
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          {/* Integration lockup: Zernio mark × Shopify wordmark */}
          <div className={styles.lockup}>
            <span className={styles.mark} aria-hidden="true">
              <img src="/brand/icon-primary.svg" alt="" />
            </span>
            <span className={styles.lockupX} aria-hidden="true">×</span>
            <span className={styles.shopify}>
              {/* Official Shopify bag mark — sourced from Shopify's brand guidelines */}
              <svg className={styles.shopifyMark} viewBox="0 0 109.5 124.5" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Shopify">
                <path d="M95.6 28.2c-.1-.6-.6-1-1.1-1-.5 0-10.3-1.8-10.3-1.8s-6.8-6.8-7.5-7.5c-.7-.7-2.1-.5-2.6-.3 0 0-1.4.4-3.6 1.1-.4-1.2-.9-2.6-1.7-4.1-2.5-4.8-6.1-7.3-10.5-7.3h-.3c-1.5-1.9-3.4-2.7-5-2.7-12.4.4-18.3 15.5-20.2 23.4-4.8 1.5-8.2 2.5-8.6 2.7-2.7.8-2.8.9-3.1 3.5-.3 1.9-7.3 56.2-7.3 56.2l54.8 10.3 29.7-6.4S95.7 28.8 95.6 28.2zM67.3 21.4l-5.7 1.8c0-3-.4-7.4-1.7-11.1 4.3.8 6.4 5.6 7.4 9.3zm-9.7 3l-12.3 3.8c1.2-4.6 3.5-9.2 6.3-12.2 1.1-1.1 2.5-2.3 4.2-3 1.7 3.5 1.8 8.5 1.8 11.4zm-8-16.9c1.4 0 2.5.5 3.5 1.4-4 1.9-8.2 6.7-10 16.3l-9.7 3c2.1-9.2 7.8-20.7 16.2-20.7z" fill="#95BF47"/>
                <path d="M94.5 27.2c-.5 0-10.3-1.8-10.3-1.8s-6.8-6.8-7.5-7.5c-.3-.3-.6-.4-1-.5l-4.1 100.5 29.7-6.4s-6-41.2-6.1-42.3c-.1-1.4-.3-1.9-.7-41z" fill="#5E8E3E"/>
                <path d="M60.7 43.9l-3.7 10.9s-3.3-1.8-7.3-1.8c-5.9 0-6.2 3.7-6.2 4.6 0 5.1 13.3 7 13.3 19 0 9.4-6 15.5-14 15.5-9.6 0-14.5-6-14.5-6l2.6-8.5s5.1 4.4 9.3 4.4c2.8 0 3.9-2.2 3.9-3.8 0-6.6-10.9-6.9-10.9-17.9 0-9.2 6.6-18.1 20-18.1 5.1.1 7.5 1.7 7.5 1.7z" fill="#FFFFFF"/>
              </svg>
              <span className={styles.shopifyWord}>Shopify</span>
            </span>
          </div>

          <h1 className={styles.headline}>
            Your Shopify catalog.
            <br />
            <span className={styles.accent}>Every social platform.</span>
            <br />
            One click.
          </h1>

          <p className={styles.sub}>
            Turn products into scheduled posts across{" "}
            <strong>{PLATFORMS.length} platforms</strong>. No copy-paste, no tab-switching. Pick a
            product, schedule, done.
          </p>

          <div className={styles.ctas}>
            <a
              href="https://admin.shopify.com/oauth/install?client_id=ee20ee832fea8bfbc7fe61e1c960b935"
              className={styles.ctaPrimary}
            >
              Install on Shopify
              <svg className={styles.ctaArrow} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </a>
            <a href="https://docs.zernio.com" className={styles.ctaSecondary}>
              Read the docs
            </a>
          </div>

          <p className={styles.meta}>
            Free to install · Requires a Zernio account · Open source (MIT)
          </p>
        </section>

        <section className={styles.platformsSection}>
          <div className={styles.platformsLabel}>Posts, publishes, and schedules to</div>
          <ul className={styles.platforms}>
            {PLATFORMS.map((p) => (
              <li key={p} className={styles.pill}>{p}</li>
            ))}
          </ul>
        </section>

        <section className={styles.how}>
          <h2 className={styles.howTitle}>How it works</h2>
          <ol className={styles.steps}>
            <li className={styles.step}>
              <span className={styles.stepNum}>01</span>
              <div>
                <h3>Install the app</h3>
                <p>One-click install from the Shopify admin. No configuration required.</p>
              </div>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum}>02</span>
              <div>
                <h3>Connect Zernio</h3>
                <p>Paste your Zernio API key. Your connected social accounts show up instantly.</p>
              </div>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum}>03</span>
              <div>
                <h3>Pick &amp; post</h3>
                <p>Select a product, choose platforms, schedule. Zernio handles the rest.</p>
              </div>
            </li>
          </ol>
        </section>

        {showForm && (
          <section className={styles.loginSection}>
            <Form className={styles.loginInner} method="post" action="/auth/login">
              <label htmlFor="shop" className={styles.loginLabel}>Already installed? Sign in</label>
              <div className={styles.loginRow}>
                <input
                  id="shop"
                  className={styles.loginInput}
                  type="text"
                  name="shop"
                  placeholder="your-store.myshopify.com"
                />
                <button className={styles.loginBtn} type="submit">Log in</button>
              </div>
            </Form>
          </section>
        )}
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <img src="/brand/logo-primary.svg" alt="Zernio" />
          <span>Social APIs for developers and AI agents.</span>
        </div>
        <nav className={styles.footerLinks}>
          <a href="https://zernio.com">zernio.com</a>
          <a href="https://docs.zernio.com">Documentation</a>
          <a href="https://github.com/zernio-dev/zernio-shopify">Source</a>
          <a href="https://zernio.com/privacy-policy">Privacy</a>
        </nav>
      </footer>
    </div>
  );
}
