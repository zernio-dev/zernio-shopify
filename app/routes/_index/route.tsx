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
];

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <span className={styles.brand}>zernio</span>
        <div className={styles.navLinks}>
          <a href="https://zernio.com" className={styles.navLink}>Platform</a>
          <a href="https://docs.zernio.com" className={styles.navLink}>Docs</a>
          <a href="https://github.com/zernio-dev/zernio-shopify" className={styles.navLink}>GitHub</a>
        </div>
      </nav>

      <main className={styles.hero}>
        <div className={styles.logoMark}>
          <span className={styles.zMark}>Z</span>
          <div className={styles.connector} />
          <svg className={styles.sMark} viewBox="0 0 109.5 124.5" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M95.6 28.2c-.1-.6-.6-1-1.1-1-.5 0-10.3-1.8-10.3-1.8s-6.8-6.8-7.5-7.5c-.7-.7-2.1-.5-2.6-.3 0 0-1.4.4-3.6 1.1-.4-1.2-.9-2.6-1.7-4.1-2.5-4.8-6.1-7.3-10.5-7.3h-.3c-1.5-1.9-3.4-2.7-5-2.7-12.4.4-18.3 15.5-20.2 23.4-4.8 1.5-8.2 2.5-8.6 2.7-2.7.8-2.8.9-3.1 3.5-.3 1.9-7.3 56.2-7.3 56.2l54.8 10.3 29.7-6.4S95.7 28.8 95.6 28.2zM67.3 21.4l-5.7 1.8c0-3-.4-7.4-1.7-11.1 4.3.8 6.4 5.6 7.4 9.3zm-9.7 3l-12.3 3.8c1.2-4.6 3.5-9.2 6.3-12.2 1.1-1.1 2.5-2.3 4.2-3 1.7 3.5 1.8 8.5 1.8 11.4zm-8-16.9c1.4 0 2.5.5 3.5 1.4-4 1.9-8.2 6.7-10 16.3l-9.7 3c2.1-9.2 7.8-20.7 16.2-20.7z" fill="#95BF47"/>
          </svg>
        </div>

        <h1 className={styles.headline}>
          Your products.<br />
          <span className={styles.headlineAccent}>Every platform.</span><br />
          One click.
        </h1>

        <p className={styles.sub}>
          Turn Shopify products into scheduled social posts
          across 14 platforms. No copy-pasting. No tab-switching.
          Just pick a product and post.
        </p>

        <div className={styles.ctas}>
          <a
            href="https://admin.shopify.com/oauth/install?client_id=ee20ee832fea8bfbc7fe61e1c960b935"
            className={styles.ctaPrimary}
          >
            Install on Shopify &rarr;
          </a>
          <a href="https://docs.zernio.com" className={styles.ctaSecondary}>
            Read docs
          </a>
        </div>

        <div className={styles.platforms}>
          <div className={styles.platformsLabel}>Works with</div>
          <div className={styles.platformsList}>
            {PLATFORMS.map(p => (
              <span key={p} className={styles.pill}>{p}</span>
            ))}
          </div>
        </div>
      </main>

      {showForm && (
        <section className={styles.loginSection}>
          <Form className={styles.loginInner} method="post" action="/auth/login">
            <input
              className={styles.loginInput}
              type="text"
              name="shop"
              placeholder="your-store.myshopify.com"
            />
            <button className={styles.loginBtn} type="submit">Log in</button>
          </Form>
        </section>
      )}

      <footer className={styles.footer}>
        <a href="https://zernio.com" className={styles.footerLink}>zernio.com</a>
        <a href="https://docs.zernio.com" className={styles.footerLink}>documentation</a>
        <a href="https://github.com/zernio-dev/zernio-shopify" className={styles.footerLink}>source code</a>
      </footer>
    </div>
  );
}
