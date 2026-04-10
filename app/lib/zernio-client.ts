/**
 * Typed HTTP client for the Zernio REST API.
 *
 * Wraps fetch calls to https://zernio.com/api/v1 and provides typed
 * request/response interfaces for all endpoints the Shopify app uses.
 *
 * See https://docs.zernio.com for the full API reference.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZernioUser {
  _id: string;
  name: string;
  email: string;
  planName: string;
  hasAccess: boolean;
}

export interface ZernioProfile {
  _id: string;
  name: string;
  description?: string;
  color: string;
  isDefault: boolean;
  accountUsernames: string[];
}

export interface ZernioAccount {
  _id: string;
  platform: string;
  username: string;
  displayName: string;
  profilePicture?: string;
  profileUrl?: string;
  isActive: boolean;
  profileId: { _id: string; name: string };
}

export interface ZernioPost {
  _id: string;
  content: string;
  status: string;
  scheduledFor: string;
  publishedAt?: string;
  platforms: Array<{
    platform: string;
    accountId: string | { _id: string; username: string };
    status: string;
    platformPostId?: string;
    platformPostUrl?: string;
    errorMessage?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePostParams {
  content: string;
  mediaItems?: Array<{ type: "image" | "video" | "gif"; url: string }>;
  platforms: Array<{
    platform: string;
    accountId: string;
    scheduledFor?: string;
    customContent?: string;
  }>;
  scheduledFor?: string;
  publishNow?: boolean;
  timezone?: string;
  tags?: string[];
  hashtags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ListPostsParams {
  status?: string;
  page?: number;
  limit?: number;
}

export interface PresignedUrlResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  type: string;
}

export interface WebhookConfig {
  _id: string;
  name: string;
  url: string;
  secret?: string;
  events: string[];
  isActive: boolean;
}

export interface CreateWebhookParams {
  name: string;
  url: string;
  secret?: string;
  events: string[];
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Client error
// ---------------------------------------------------------------------------

export class ZernioApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ZernioApiError";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ZernioClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(
    apiKey: string,
    baseUrl = "https://zernio.com/api/v1",
  ) {
    this.baseUrl = baseUrl;
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  // ---- helpers ------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      throw new ZernioApiError(
        json?.error || `Zernio API error ${res.status}`,
        res.status,
        json,
      );
    }

    return json as T;
  }

  // ---- endpoints ----------------------------------------------------------

  /** Verify the API key and return the authenticated user. */
  async getUser(): Promise<ZernioUser> {
    const data = await this.request<{ user: ZernioUser }>("GET", "/user");
    return data.user;
  }

  /** List all profiles for the authenticated user. */
  async getProfiles(): Promise<ZernioProfile[]> {
    const data = await this.request<{ profiles: ZernioProfile[] }>(
      "GET",
      "/profiles",
    );
    return data.profiles;
  }

  /** List connected social accounts, optionally filtered by profile. */
  async getAccounts(profileId?: string): Promise<ZernioAccount[]> {
    const qs = profileId ? `?profileId=${profileId}` : "";
    const data = await this.request<{ accounts: ZernioAccount[] }>(
      "GET",
      `/accounts${qs}`,
    );
    return data.accounts;
  }

  /** Create a post (schedule or publish now). */
  async createPost(params: CreatePostParams): Promise<ZernioPost> {
    const data = await this.request<{ post: ZernioPost }>(
      "POST",
      "/posts",
      params,
    );
    return data.post;
  }

  /** List posts with optional filtering. */
  async getPosts(
    params?: ListPostsParams,
  ): Promise<{ posts: ZernioPost[]; pagination?: Record<string, number> }> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.request("GET", `/posts${query}`);
  }

  /** Get a presigned URL for uploading media. */
  async getPresignedUrl(
    filename: string,
    contentType: string,
  ): Promise<PresignedUrlResponse> {
    return this.request("POST", "/media/presign", { filename, contentType });
  }

  /** Register a webhook endpoint to receive post status updates. */
  async createWebhook(params: CreateWebhookParams): Promise<WebhookConfig> {
    const data = await this.request<{ webhook: WebhookConfig }>(
      "POST",
      "/webhooks/settings",
      params,
    );
    return data.webhook;
  }

  /** List registered webhooks. */
  async getWebhooks(): Promise<WebhookConfig[]> {
    const data = await this.request<{ webhooks: WebhookConfig[] }>(
      "GET",
      "/webhooks/settings",
    );
    return data.webhooks;
  }
}
