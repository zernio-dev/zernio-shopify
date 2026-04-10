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

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.logo}>Zernio</span>
          <nav className={styles.headerNav}>
            <a href="https://zernio.com" className={styles.headerLink}>
              Website
            </a>
            <a href="https://docs.zernio.com" className={styles.headerLink}>
              Docs
            </a>
            <a
              href="https://admin.shopify.com/oauth/install?client_id=ee20ee832fea8bfbc7fe61e1c960b935"
              className={styles.ctaSmall}
            >
              Install app
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className={styles.hero}>
        <div className={styles.heroContent}>
          <h1 className={styles.heading}>
            Schedule social posts
            <br />
            for your Shopify products
          </h1>
          <p className={styles.subheading}>
            Connect your store to 14+ social platforms. Turn product launches
            into scheduled posts across Instagram, TikTok, X, LinkedIn, Facebook,
            and more, all from your Shopify admin.
          </p>
          <div className={styles.ctaGroup}>
            <a
              href="https://admin.shopify.com/oauth/install?client_id=ee20ee832fea8bfbc7fe61e1c960b935"
              className={styles.ctaPrimary}
            >
              Install on Shopify
            </a>
            <a href="https://docs.zernio.com" className={styles.ctaSecondary}>
              Read the docs
            </a>
          </div>
        </div>
      </main>

      {/* Features */}
      <section className={styles.features}>
        <div className={styles.featuresGrid}>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>&#128197;</div>
            <h3 className={styles.featureTitle}>Schedule posts</h3>
            <p className={styles.featureDesc}>
              Pick a date and time, or publish immediately. Posts go out
              automatically via the Zernio scheduling engine.
            </p>
          </div>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>&#127760;</div>
            <h3 className={styles.featureTitle}>14+ platforms</h3>
            <p className={styles.featureDesc}>
              Instagram, TikTok, X, Facebook, LinkedIn, YouTube, Threads,
              Pinterest, Telegram, Bluesky, and more.
            </p>
          </div>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>&#128230;</div>
            <h3 className={styles.featureTitle}>Product-first</h3>
            <p className={styles.featureDesc}>
              Auto-fills captions, images, and store links from your product
              catalog. Share in two clicks.
            </p>
          </div>
        </div>
      </section>

      {/* Manual login (fallback for non-install flows) */}
      {showForm && (
        <section className={styles.loginSection}>
          <h2 className={styles.loginHeading}>Already installed?</h2>
          <p className={styles.loginText}>
            Enter your shop domain to open the app.
          </p>
          <Form className={styles.form} method="post" action="/auth/login">
            <input
              className={styles.input}
              type="text"
              name="shop"
              placeholder="my-shop.myshopify.com"
            />
            <button className={styles.loginButton} type="submit">
              Log in
            </button>
          </Form>
        </section>
      )}

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span className={styles.footerBrand}>Zernio</span>
          <div className={styles.footerLinks}>
            <a href="https://zernio.com" className={styles.footerLink}>
              zernio.com
            </a>
            <a href="https://docs.zernio.com" className={styles.footerLink}>
              Documentation
            </a>
            <a
              href="https://github.com/zernio-dev/zernio-shopify"
              className={styles.footerLink}
            >
              Source code
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
