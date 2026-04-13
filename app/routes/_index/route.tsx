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
    <main className={styles.page}>
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
        Free · <a href="https://github.com/zernio-dev/zernio-shopify">Open source</a> ·{" "}
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
          <button className={styles.loginBtn} type="submit">Sign in</button>
        </Form>
      )}
    </main>
  );
}
