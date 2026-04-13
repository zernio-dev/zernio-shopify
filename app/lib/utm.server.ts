/**
 * UTM tracking helpers.
 *
 * When a merchant enables UTM tracking in Settings, every product URL we
 * emit in post content is decorated with utm_source/utm_medium/utm_campaign
 * so they can attribute social traffic in Shopify analytics. We only touch
 * URLs that point at the merchant's own storefront — third-party links
 * (their own Linktree, etc.) are left alone.
 */

interface UtmOptions {
  /** Shop's myshopify.com or custom domain — used to scope which links we touch. */
  shop: string;
  /** Platform identifier ("instagram", "tiktok", ...) — becomes utm_campaign. */
  platform?: string;
  /** Optional tag for utm_content (typically the Zernio post id). */
  postId?: string;
}

/**
 * Append UTM params to every storefront URL inside `content`.
 *
 * Returns the original string when:
 *   - the content has no URLs
 *   - none of the URLs match the shop domain
 *   - a URL is malformed
 *
 * Existing query strings are preserved; we never overwrite user-set utm_*.
 */
export function injectUtm(content: string, opts: UtmOptions): string {
  if (!content) return content;

  // Match http(s) URLs. Anything else (mailto:, tel:) is ignored.
  const urlPattern = /https?:\/\/[^\s)\]]+/g;

  return content.replace(urlPattern, (raw) => {
    try {
      const url = new URL(raw);
      // Only decorate the merchant's own storefront. We accept both the
      // myshopify.com domain and any custom domain the shop has, but the
      // call site only knows the myshopify domain — so we just check for
      // exact host match here. Custom-domain support can come later via
      // GraphQL `shop.primaryDomain`.
      if (url.host !== opts.shop && !opts.shop.endsWith(url.host)) {
        return raw;
      }

      const params = url.searchParams;
      // Don't clobber any utm_ a merchant already set in their content.
      if (!params.has("utm_source")) params.set("utm_source", "zernio");
      if (!params.has("utm_medium")) params.set("utm_medium", "social");
      if (opts.platform && !params.has("utm_campaign")) {
        params.set("utm_campaign", opts.platform);
      }
      if (opts.postId && !params.has("utm_content")) {
        params.set("utm_content", opts.postId);
      }
      url.search = params.toString();
      return url.toString();
    } catch {
      // Malformed URL — leave untouched
      return raw;
    }
  });
}
