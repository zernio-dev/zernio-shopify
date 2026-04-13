import type { MetaFunction } from "react-router";
import styles from "./styles.module.css";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy — Zernio for Shopify" },
  {
    name: "description",
    content:
      "How the Zernio for Shopify app handles your store data. Encrypted API keys, no customer PII, full deletion on uninstall.",
  },
];

export default function PrivacyPolicy() {
  return (
    <main className={styles.page}>
      <article className={styles.doc}>
        <header className={styles.header}>
          <a href="/" className={styles.brand} aria-label="Zernio for Shopify">
            <img src="/brand/logo-primary.svg" alt="Zernio" className={styles.logo} />
          </a>
          <p className={styles.meta}>Last updated: 2026-04-13</p>
        </header>

        <h1 className={styles.h1}>Privacy Policy — Zernio for Shopify</h1>

        <p>
          This policy describes what data the <strong>Zernio for Shopify</strong>{" "}
          app (the "App") collects from your Shopify store, how it's used, and
          how you can delete it. It covers only what this app does; Zernio's
          main platform policy applies to the social posting side and is
          available at{" "}
          <a href="https://zernio.com/privacy-policy">zernio.com/privacy-policy</a>.
        </p>

        <h2 className={styles.h2}>Who is the data controller</h2>
        <p>
          The App is operated by <strong>Zernio</strong> (operator of{" "}
          <a href="https://zernio.com">zernio.com</a>). Questions:{" "}
          <a href="mailto:support@zernio.com">support@zernio.com</a>.
        </p>

        <h2 className={styles.h2}>What we collect</h2>
        <p>
          The App is <strong>deliberately narrow</strong>. When you install it,
          we store only the following for your shop:
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>What</th>
              <th>Why</th>
              <th>Retention</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Your Shopify shop domain (<code>yourstore.myshopify.com</code>)
              </td>
              <td>Identify your install</td>
              <td>Until uninstall + 48 h</td>
            </tr>
            <tr>
              <td>
                Your Zernio API key, <strong>encrypted at rest</strong> (AES-256-GCM)
              </td>
              <td>Authenticate API calls on your behalf</td>
              <td>Until uninstall + 48 h</td>
            </tr>
            <tr>
              <td>Your default Zernio profile ID and timezone</td>
              <td>Compose and schedule posts correctly</td>
              <td>Until uninstall + 48 h</td>
            </tr>
            <tr>
              <td>Your saved post templates</td>
              <td>Auto-publish and compose quick-starts</td>
              <td>Until uninstall + 48 h</td>
            </tr>
            <tr>
              <td>
                A log of each post the App creates (status, trigger, platforms,
                timestamps)
              </td>
              <td>Show post history; fulfill status webhooks</td>
              <td>Until uninstall + 48 h</td>
            </tr>
            <tr>
              <td>Inventory snapshots per variant (current available count)</td>
              <td>Detect back-in-stock transitions for the auto-publish trigger</td>
              <td>Until uninstall + 48 h</td>
            </tr>
            <tr>
              <td>Shopify session tokens (offline)</td>
              <td>Maintain authenticated admin access</td>
              <td>Deleted immediately on uninstall</td>
            </tr>
          </tbody>
        </table>

        <p>
          <strong>We do NOT collect, store, or process:</strong>
        </p>
        <ul>
          <li>
            Any customer personally identifiable information (name, email,
            address, phone, orders, payments)
          </li>
          <li>Any marketing lists</li>
          <li>
            Any product inventory data beyond the <code>available</code> count
            needed for the back-in-stock trigger
          </li>
          <li>Any analytics, tracking cookies, or third-party telemetry</li>
        </ul>

        <h2 className={styles.h2}>What happens to your data after you uninstall</h2>
        <ul>
          <li>
            <strong>Immediately on uninstall</strong> — your Shopify session is
            removed (you lose admin access through the App).
          </li>
          <li>
            <strong>~48 hours after uninstall</strong> — Shopify fires the{" "}
            <code>shop/redact</code> compliance webhook. On receipt, the App
            deletes your <code>ShopConfig</code> row (including the encrypted
            API key), every <code>PostLog</code> for your shop, every{" "}
            <code>PostTemplate</code> you created, every{" "}
            <code>InventorySnapshot</code> for your shop, and any lingering
            session rows.
          </li>
        </ul>
        <p>Deletions are cascade-enforced at the database level.</p>

        <h2 className={styles.h2}>Customer data webhooks</h2>
        <p>
          The App handles Shopify's three mandatory data compliance webhooks:
        </p>
        <ul>
          <li>
            <code>customers/data_request</code> — no-op. The App stores no
            customer PII, so there is nothing to return.
          </li>
          <li>
            <code>customers/redact</code> — no-op for the same reason.
          </li>
          <li>
            <code>shop/redact</code> — full cascade delete of your shop's App
            data as described above.
          </li>
        </ul>
        <p>
          Each webhook validates the incoming shop string against the canonical{" "}
          <code>myshopify.com</code> format before running any delete, and
          returns HTTP 200 in all cases per Shopify's requirements.
        </p>

        <h2 className={styles.h2}>Third parties</h2>
        <p>
          The App transmits your shop domain, post content, media URLs, and
          platform/account selections to <strong>Zernio</strong> (
          <a href="https://zernio.com">zernio.com</a>) in order to create and
          schedule posts. This happens through authenticated HTTPS calls using
          the API key you provided. See Zernio's platform privacy policy for
          how Zernio handles that data.
        </p>
        <p>The App does not share your data with any other third party.</p>

        <h2 className={styles.h2}>Cookies</h2>
        <p>
          The App uses only Shopify's session cookies required for the
          embedded admin experience. No tracking, no analytics, no advertising
          cookies.
        </p>

        <h2 className={styles.h2}>Security</h2>
        <ul>
          <li>
            Zernio API keys are encrypted at rest using{" "}
            <strong>AES-256-GCM</strong> with an app-level key held in the
            hosting environment's encrypted secrets store.
          </li>
          <li>All network traffic uses TLS 1.2+.</li>
          <li>
            The App is open-source; the full data model and handling logic is
            auditable at{" "}
            <a href="https://github.com/zernio-dev/zernio-shopify">
              github.com/zernio-dev/zernio-shopify
            </a>
            .
          </li>
        </ul>

        <h2 className={styles.h2}>Your rights</h2>
        <p>
          As the merchant operator of your shop, you can at any time:
        </p>
        <ul>
          <li>
            <strong>Rotate your Zernio API key</strong> in Settings → Zernio
            connection → Replace API key. The App re-encrypts and stores the
            new key; the old one is overwritten.
          </li>
          <li>
            <strong>Disconnect Zernio</strong> — rotate the API key to an
            invalid value, or uninstall the App entirely.
          </li>
          <li>
            <strong>Request deletion</strong> — uninstall the App. The{" "}
            <code>shop/redact</code> webhook will trigger full deletion within
            ~48 hours, per Shopify's compliance framework.
          </li>
          <li>
            <strong>Access your data</strong> — email{" "}
            <a href="mailto:support@zernio.com">support@zernio.com</a>; we will
            send the full contents of your <code>ShopConfig</code> + related
            rows within 30 days.
          </li>
        </ul>
        <p>
          If you are an EU / UK / California resident you also have the right
          to lodge a complaint with your data protection authority.
        </p>

        <h2 className={styles.h2}>Sub-processors</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Purpose</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Vercel</td>
              <td>App hosting</td>
              <td>Global edge; primary region us-east-1</td>
            </tr>
            <tr>
              <td>Neon</td>
              <td>PostgreSQL database (encrypted API keys, post logs)</td>
              <td>us-east-1</td>
            </tr>
            <tr>
              <td>Shopify</td>
              <td>OAuth, webhooks, product/inventory data fetch</td>
              <td>Global</td>
            </tr>
            <tr>
              <td>Zernio</td>
              <td>Social posting infrastructure</td>
              <td>
                See{" "}
                <a href="https://zernio.com/privacy-policy">
                  zernio.com/privacy-policy
                </a>
              </td>
            </tr>
          </tbody>
        </table>

        <h2 className={styles.h2}>Changes to this policy</h2>
        <p>
          We will announce material changes via the App's Settings page and
          update the "Last updated" date above. Continued use of the App after
          an update constitutes acceptance of the revised policy.
        </p>

        <h2 className={styles.h2}>Contact</h2>
        <p>
          <a href="mailto:support@zernio.com">support@zernio.com</a>
        </p>

        <footer className={styles.footer}>
          <a href="/">← Back to zernio for shopify</a>
        </footer>
      </article>
    </main>
  );
}
