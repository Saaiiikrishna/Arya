/**
 * Store / commerce API client (SpaceKart storefront surface).
 *
 * This is the CUSTOMER-facing companion to the platform admin client in
 * `@/lib/api.ts`. It is a SEPARATE client with its own token slots so a logged-in
 * platform admin and a logged-in store customer never collide:
 *
 *   - Customer access token  → in memory only (never localStorage; XSS-readable).
 *   - Customer refresh token  → sessionStorage `arya_store_refresh`, sent in the
 *                               body to POST /store/auth/refresh; rotated on use
 *                               with RFC 9700 family reuse detection (server-side).
 *                               Body transport is REQUIRED cross-domain (the API
 *                               is on a different registrable domain than the SPA,
 *                               so the HttpOnly cookie the server also sets is a
 *                               third-party cookie browsers block). Independent of
 *                               the platform `arya_refresh`. Once the API is served
 *                               same-site (api.aryavartham.com) the cookie carries
 *                               it and this body token can be retired.
 *   - Guest cart token        → localStorage `arya_cart_token`, sent as the
 *                               `X-Cart-Token` header on cart/checkout calls.
 *   - Guest order token       → NOT persisted globally; the caller holds it (it is
 *                               returned once from checkout) and passes it per-call;
 *                               it is sent as the `X-Order-Token` header.
 *
 * The base URL is `NEXT_PUBLIC_API_URL` (which already includes the `/api` prefix),
 * so every endpoint here is spelled WITHOUT the leading `/api` (e.g. `/store/...`).
 *
 * On a 401 for an authenticated customer request, the client refreshes the
 * customer token once and retries (de-duped across concurrent callers), mirroring
 * the admin client's recovery behaviour. The guest-token paths never trigger a
 * refresh — a guest has no refresh token.
 */

import { ApiError, api } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

// sessionStorage / localStorage keys — kept distinct from the admin client's keys.
// The customer refresh token is persisted + sent in the body: the API is on a
// different registrable domain than the SPA, so the HttpOnly refresh cookie is a
// third-party cookie browsers block. credentials:'include' is still sent so the
// cookie ALSO works once the API is served same-site (api.aryavartham.com).
const STORE_REFRESH_KEY = 'arya_store_refresh';
const CART_TOKEN_KEY = 'arya_cart_token';

/**
 * Media kind for product + article uploads.
 *
 * TRADE-OFF (documented): this hand-rolled union intentionally duplicates the
 * backend `ProductMediaType` / `ArticleMediaType` Prisma enums (which are
 * identical — COMMERCE_ARCHITECTURE §2.1). There is no shared types package
 * between backend and frontend, so a single source cannot be imported. If the
 * backend ever adds a member (e.g. `'THREE_D'`), update this union in lock-step.
 */
export type MediaType = 'IMAGE' | 'VIDEO';

interface StoreRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Attach the customer Authorization header (default true for authed calls). */
  auth?: boolean;
  /** Attach the guest X-Cart-Token header if one exists in storage. */
  cartToken?: boolean;
  /** Explicit guest order token → sent as X-Order-Token. */
  orderToken?: string | null;
  /** Internal: skip the 401 refresh+retry (used for the refresh call + the retry). */
  skipAuthRetry?: boolean;
  /** Send a raw (non-JSON) body verbatim — used by the S3 presigned PUT helper. */
  raw?: boolean;
}

/** Shape returned by both customer auth endpoints (login / verify-otp / refresh). */
export interface CustomerAuthResult {
  accessToken: string;
  refreshToken: string;
  customer?: unknown;
}

/** Shape returned by POST /store/checkout. */
export interface CheckoutResult {
  orderId: string;
  orderNumber?: string;
  razorpayOrderId: string;
  amount: number; // integer paise
  currency: string;
  key: string; // Razorpay public key id
  guestOrderToken?: string; // present only for the guest path — capture it once
}

// ── Public return shapes ───────────────────────────────────────────────────
// These give consumers (agents B/C) compile-time safety on the most-used reads.
// They are deliberately PERMISSIVE supersets of the backend DTOs: every shape
// carries an open `[k: string]: unknown` index so a backend field this layer
// has not enumerated is still reachable (cast at the call site) rather than a
// type error. ALL money fields are INTEGER PAISE — format to rupees in the UI.

/** Cursor/offset list envelope used by paginated store reads. */
export interface ListResponse<T> {
  data: T[];
  /**
   * Pagination envelope per COMMERCE_ARCHITECTURE §1488: `{page, limit, total,
   * totalPages}`. `totalPages` is first-class (server-computed) so consumers can
   * read it without a cast; the open index keeps any extra fields reachable.
   */
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** A product card as returned by the public catalog list. */
export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  subtitle?: string | null;
  brand?: string | null;
  /** Lowest available SKU price in INTEGER PAISE (server-computed). */
  priceFrom?: number | null;
  /** Highest available SKU price in INTEGER PAISE — drives the "From …" range hint. */
  priceTo?: number | null;
  currency?: string;
  isFeatured?: boolean;
  primaryImageUrl?: string | null;
  /**
   * Card thumbnail (a `ProductMedia` per COMMERCE_ARCHITECTURE §2.2) served on the
   * list payload as a fallback when `primaryImageUrl` is absent.
   */
  thumbnail?: { url?: string | null; altText?: string | null; caption?: string | null } | null;
  /**
   * Category for the card eyebrow. On the LIST payload this is the denormalised
   * category NAME string (§2.2); on `ProductDetail` it is the full category object.
   * The union covers both so a subtype can narrow without an incompatible-override
   * error. List consumers read it as a string; detail consumers narrow to the object.
   */
  category?: string | Record<string, unknown> | null;
  /**
   * Denormalised average rating (0..5, may be fractional) derived server-side from
   * `Product.ratingSum / Product.ratingCount`. Present on both list and detail
   * payloads; `null`/absent when the product has no approved ratings yet.
   */
  ratingAverage?: number | null;
  /** Count of APPROVED ratings (the `Product.ratingCount` denormalised column). */
  ratingCount?: number | null;
  [k: string]: unknown;
}

export type ProductListResponse = ListResponse<ProductSummary>;

/** Full product detail (PDP). SKU/tier prices are INTEGER PAISE. */
export interface ProductDetail extends ProductSummary {
  shortDescription?: string | null;
  description?: string | null;
  tags?: string[];
  skus?: Array<Record<string, unknown>>;
  media?: Array<Record<string, unknown>>;
  tabs?: Array<Record<string, unknown>>;
  /** On the PDP this is the full category object (overrides the list's string form). */
  category?: Record<string, unknown> | null;
  [k: string]: unknown;
}

/** The DIY /build view (BOM + bundle + per-line availability). */
export interface ProductBuild {
  guideId?: string;
  product?: Record<string, unknown>;
  bom?: Array<Record<string, unknown>>;
  bundle?: Record<string, unknown> | null;
  [k: string]: unknown;
}

/** A cart with recomputed totals (all amounts INTEGER PAISE). */
export interface CartResponse {
  id: string;
  status?: string;
  items: Array<Record<string, unknown>>;
  subtotal?: number;
  discount?: number;
  tax?: number;
  shipping?: number;
  total?: number;
  currency?: string;
  coupon?: Record<string, unknown> | null;
  [k: string]: unknown;
}

/** A single order detail (all money fields INTEGER PAISE). */
export interface OrderDetail {
  id: string;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  items?: Array<Record<string, unknown>>;
  subtotal?: number;
  discount?: number;
  tax?: number;
  shipping?: number;
  total?: number;
  currency?: string;
  shippingAddress?: Record<string, unknown> | null;
  billingAddress?: Record<string, unknown> | null;
  createdAt?: string;
  [k: string]: unknown;
}

export type OrderListResponse = ListResponse<OrderDetail>;

/** Shipment + event timeline for one order. */
export interface OrderTracking {
  orderId?: string;
  status?: string;
  shipment?: Record<string, unknown> | null;
  events?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/** A fresh presigned invoice-download URL for one order. */
export interface OrderInvoice {
  url: string;
  [k: string]: unknown;
}

/** An article card as returned by the public list. */
export interface ArticleSummary {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  coverUrl?: string | null;
  tags?: string[];
  /**
   * Server-emitted featured flag. The backend `toPublicListItem` derives this
   * from the reserved FEATURED_TAG and serialises it as `isFeatured` (NOT
   * `featured`); the field name MUST match the JSON key or the featured strip
   * never populates. Keep this in lock-step with `ArticlesService.toPublicListItem`.
   */
  isFeatured?: boolean;
  publishedAt?: string | null;
  [k: string]: unknown;
}

export type ArticleListResponse = ListResponse<ArticleSummary>;

/** Full article detail (rich body + media). */
export interface ArticleDetail extends ArticleSummary {
  body?: Record<string, unknown> | null;
  media?: Array<Record<string, unknown>>;
  author?: Record<string, unknown> | null;
  [k: string]: unknown;
}

// ── Reviews ─────────────────────────────────────────────────────────────────
// Fixed contract (REVIEW API CONTRACT). All shapes match the backend DTOs the
// reviews-backend unit emits. `rating` is always an integer 1..5.

/** A single APPROVED, public-facing product review row. */
export interface ProductReview {
  id: string;
  rating: number;
  title?: string | null;
  // Non-nullable: the backend PublicReviewDto maps `body` directly from
  // Review.body (@db.Text NOT NULL), so it is always a present string.
  body: string;
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  authorName?: string | null;
  createdAt: string;
  [k: string]: unknown;
}

/** Aggregate rating summary for a product (average + count + per-star breakdown). */
export interface ReviewSummary {
  average: number;
  count: number;
  breakdown: { 5: number; 4: number; 3: number; 2: number; 1: number };
  [k: string]: unknown;
}

/**
 * The public reviews list envelope: paginated data + the rating summary.
 *
 * `summary` is typed OPTIONAL: the backend always emits it, but `ListResponse<T>`
 * carries an open `[k: string]: unknown` index so TypeScript cannot enforce its
 * presence at the call site. A required annotation would let careless callers skip
 * the guard and crash on a malformed/empty response; optional forces the
 * resilience-minded `if (res.summary)` check that the consumer already performs.
 */
export interface ProductReviewListResponse extends ListResponse<ProductReview> {
  summary?: ReviewSummary;
}

class StoreApiClient {
  private token: string | null = null;
  // De-dupes concurrent refreshes so a burst of 401s triggers a single refresh.
  private refreshPromise: Promise<boolean> | null = null;

  // ── Customer token management ─────────────────────────────

  setCustomerToken(token: string | null): void {
    this.token = token;
    // Access token kept in memory only — localStorage is readable by any XSS script.
  }

  clearCustomerToken(): void {
    this.token = null;
    this.refreshPromise = null;
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(STORE_REFRESH_KEY);
    }
  }

  getCustomerToken(): string | null {
    return this.token;
  }

  // ── Guest cart token management ───────────────────────────
  //
  // STORAGE TRADE-OFF (security, accepted): the guest cart token lives in
  // localStorage (per the store API contract) so a guest's cart survives a tab
  // close / reopen and is shared across tabs — the expected shopping-cart UX. The
  // cost is that any same-origin XSS could read + exfiltrate it and hijack the
  // GUEST cart (add/remove items, apply a coupon, or check out). This is strictly
  // lower-severity than leaking an auth token: the cart holds no PII and no
  // payment instrument, and checkout still routes through Razorpay. The customer
  // ACCESS token is therefore kept in MEMORY only (never localStorage), and the
  // guest ORDER token is never persisted globally (passed per-call). The cart
  // token is single-use after merge — `convertGuestCart()` clears it on first
  // login. If cart persistence is ever dropped, migrate this to sessionStorage.

  getCartToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(CART_TOKEN_KEY);
  }

  setCartToken(token: string | null): void {
    if (typeof window === 'undefined') return;
    if (token) localStorage.setItem(CART_TOKEN_KEY, token);
    else localStorage.removeItem(CART_TOKEN_KEY);
  }

  clearCartToken(): void {
    this.setCartToken(null);
  }

  // ── Refresh (customer slot) ───────────────────────────────

  async refreshCustomerToken(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (this.refreshPromise) return this.refreshPromise;

    // The customer refresh token is persisted + sent in the body (reliable
    // cross-domain); credentials:'include' (set in request()) also forwards the
    // HttpOnly cookie once the API is served same-site.
    const refreshToken = sessionStorage.getItem(STORE_REFRESH_KEY);
    if (!refreshToken) return false;

    this.refreshPromise = (async () => {
      try {
        const data = await this.request<CustomerAuthResult>('/store/auth/refresh', {
          method: 'POST',
          body: { refreshToken },
          auth: false,
          skipAuthRetry: true,
        });
        this.token = data.accessToken;
        if (data.refreshToken) sessionStorage.setItem(STORE_REFRESH_KEY, data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  // ── Core request ──────────────────────────────────────────

  private async request<T>(endpoint: string, options: StoreRequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      body,
      auth = true,
      cartToken = false,
      orderToken = null,
      skipAuthRetry = false,
      raw = false,
    } = options;

    const headers: Record<string, string> = { ...(options.headers || {}) };

    // Customer token is the primary credential for this client. For the
    // dual-issuer article-author endpoints (guarded by ArticleAuthorGuard, which
    // accepts EITHER a store CUSTOMER `jwt-customer` token OR a platform APPLICANT
    // `jwt` token), a logged-in platform applicant has NO customer session — so
    // `this.token` is null. Fall back to the platform `api` access token (held in
    // memory by the admin/platform client) so an APPLICANT can author/save-draft.
    // The customer-refresh 401 recovery below stays keyed on the CUSTOMER token
    // only: a platform applicant has no customer refresh token, and the platform
    // `api` client manages its own access-token refresh independently.
    const token = this.token;
    if (auth) {
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        const platformToken = api.getToken();
        if (platformToken) headers['Authorization'] = `Bearer ${platformToken}`;
      }
    }
    if (cartToken) {
      const ct = this.getCartToken();
      if (ct) headers['X-Cart-Token'] = ct;
    }
    if (orderToken) {
      headers['X-Order-Token'] = orderToken;
    }
    if (body !== undefined && !raw && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers,
        body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
        signal: controller.signal,
        // Send the HttpOnly store refresh cookie on auth calls (refresh/logout).
        // Backend CORS uses an explicit origin allow-list + credentials, so safe.
        credentials: 'include',
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as { name?: string })?.name === 'AbortError') {
        throw new Error('Connection timed out. The server took too long to respond.');
      }
      throw error;
    }
    clearTimeout(timeoutId);

    // 401 recovery: refresh the customer token once, then retry. Only for authed
    // calls with a live token — guest paths have no refresh token.
    if (response.status === 401 && !skipAuthRetry && auth && token) {
      const refreshed = await this.refreshCustomerToken();
      if (refreshed) {
        return this.request<T>(endpoint, { ...options, skipAuthRetry: true });
      }
      this.clearCustomerToken();
      throw new ApiError(401, 'Session expired. Please sign in again.');
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new ApiError(response.status, err.message || `HTTP ${response.status}`);
    }

    if (response.status === 204) return {} as T;
    // Some endpoints (e.g. presigned PUT) return no JSON body.
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  // Build a querystring from a params object, dropping undefined/null/'' values.
  private qs(params: Record<string, unknown> = {}): string {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)] as [string, string]);
    const s = new URLSearchParams(entries).toString();
    return s ? `?${s}` : '';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  AUTH (customer)
  // ════════════════════════════════════════════════════════════════════════

  async registerCustomer(body: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    phone?: string;
  }): Promise<CustomerAuthResult> {
    const data = await this.request<CustomerAuthResult>('/store/auth/register', {
      method: 'POST',
      body,
      auth: false,
    });
    this.applyAuth(data);
    return data;
  }

  async loginCustomer(body: { email: string; password: string }): Promise<CustomerAuthResult> {
    const data = await this.request<CustomerAuthResult>('/store/auth/login', {
      method: 'POST',
      body,
      auth: false,
    });
    this.applyAuth(data);
    return data;
  }

  async requestCustomerOtp(email: string): Promise<{ success?: boolean; message?: string }> {
    return this.request('/store/auth/request-otp', { method: 'POST', body: { email }, auth: false });
  }

  async verifyCustomerOtp(email: string, otp: string): Promise<CustomerAuthResult> {
    const data = await this.request<CustomerAuthResult>('/store/auth/verify-otp', {
      method: 'POST',
      body: { email, otp },
      auth: false,
    });
    this.applyAuth(data);
    return data;
  }

  async googleLoginCustomer(token: string): Promise<CustomerAuthResult> {
    const data = await this.request<CustomerAuthResult>('/store/auth/google', {
      method: 'POST',
      body: { token },
      auth: false,
    });
    this.applyAuth(data);
    return data;
  }

  /**
   * Fetch the Discord OAuth2 authorize URL to redirect the customer to. Returns
   * null when Discord is not configured (the backend replies 404 in that case) so
   * the caller can hide the "Continue with Discord" button — config-gated feature.
   * Never throws: any error (including the 404) resolves to null.
   */
  async getDiscordAuthUrl(): Promise<string | null> {
    try {
      const res = await this.request<{ url?: string }>('/store/auth/discord/url', {
        auth: false,
      });
      return res?.url ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Exchange a Discord OAuth2 authorization code (from the callback redirect) for
   * a CUSTOMER token pair and persist the session (same slots as login/register).
   * `state` is the anti-CSRF nonce Discord round-trips back to the callback; the
   * backend verifies + single-use-consumes it before exchanging the code.
   */
  async loginWithDiscord(
    code: string,
    state: string,
  ): Promise<CustomerAuthResult> {
    const data = await this.request<CustomerAuthResult>('/store/auth/discord', {
      method: 'POST',
      body: { code, state },
      auth: false,
    });
    this.applyAuth(data);
    return data;
  }

  /** Manual refresh (the request layer also auto-refreshes on 401). */
  async refreshCustomer(): Promise<boolean> {
    return this.refreshCustomerToken();
  }

  async logoutCustomer(): Promise<void> {
    if (typeof window !== 'undefined') {
      const rt = sessionStorage.getItem(STORE_REFRESH_KEY);
      if (rt) {
        // Fire-and-forget revocation — send the token in the body (the reliable
        // cross-domain credential); credentials:'include' also forwards the cookie
        // when same-site. The endpoint revokes the whole token family server-side.
        this.request('/store/auth/logout', { method: 'POST', body: { refreshToken: rt }, auth: false }).catch(
          () => undefined,
        );
      }
    }
    this.clearCustomerToken();
  }

  /**
   * Merge a guest cart into the just-authenticated customer's cart (first login).
   * Requires an active customer session: the backend `convert-guest` route is
   * behind `CustomerJwtGuard`, so `auth` is left at its default (true) and the
   * customer token is attached. The raw guest cart token travels in the BODY (not
   * the X-Cart-Token header) per `ConvertGuestDto`.
   */
  async convertGuestCart(cartToken?: string): Promise<unknown> {
    const ct = cartToken ?? this.getCartToken();
    const res = await this.request('/store/auth/convert-guest', { method: 'POST', body: { cartToken: ct } });
    // The guest cart token is single-use once merged — drop it.
    this.clearCartToken();
    return res;
  }

  async meCustomer(): Promise<unknown> {
    return this.request('/store/auth/me');
  }

  private applyAuth(data: CustomerAuthResult): void {
    this.setCustomerToken(data.accessToken);
    // Persist the refresh token so a silent refresh survives reload + works
    // cross-domain. The server ALSO sets an HttpOnly cookie (used once the API is
    // same-site); the body token is the reliable transport meanwhile.
    if (typeof window !== 'undefined' && data.refreshToken) {
      sessionStorage.setItem(STORE_REFRESH_KEY, data.refreshToken);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CATALOG (public)
  // ════════════════════════════════════════════════════════════════════════

  async listProducts(params: Record<string, unknown> = {}): Promise<ProductListResponse> {
    return this.request(`/store/products${this.qs(params)}`, { auth: false });
  }

  async getProduct(slug: string): Promise<ProductDetail> {
    return this.request(`/store/products/${encodeURIComponent(slug)}`, { auth: false });
  }

  async getProductBuild(slug: string): Promise<ProductBuild> {
    return this.request(`/store/products/${encodeURIComponent(slug)}/build`, { auth: false });
  }

  async getCategories(): Promise<unknown> {
    return this.request('/store/categories', { auth: false });
  }

  async getAvailability(skuId: string): Promise<unknown> {
    return this.request(`/store/availability/${encodeURIComponent(skuId)}`, { auth: false });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  REVIEWS (public list + helpful; customer create)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Public list of APPROVED reviews for a product, plus the aggregate `summary`
   * ({ average, count, breakdown }). `params` supports page / limit / sort
   * (e.g. 'recent' | 'helpful' | 'rating_desc' — server-validated). Public read,
   * so no auth header.
   */
  async listProductReviews(
    productId: string,
    params: Record<string, unknown> = {},
  ): Promise<ProductReviewListResponse> {
    return this.request(
      `/store/products/${encodeURIComponent(productId)}/reviews${this.qs(params)}`,
      { auth: false },
    );
  }

  /**
   * Submit a review for a product (CustomerJwtGuard — requires a logged-in
   * customer). Creates a PENDING review awaiting moderation; one per customer per
   * product (server-enforced @@unique). `isVerifiedPurchase` is set server-side.
   */
  async submitReview(
    productId: string,
    // `body` is required: the backend CreateReviewDto has `body!: string` with
    // @MinLength(1), so a missing body is a 400 — enforce it at compile time.
    payload: { rating: number; title?: string; body: string },
  ): Promise<ProductReview> {
    return this.request(`/store/products/${encodeURIComponent(productId)}/reviews`, {
      method: 'POST',
      body: payload,
    });
  }

  /**
   * Mark a review as helpful. CUSTOMER-authed: the backend route is now
   * CustomerJwtGuard-gated for TRUE per-user dedupe (one vote per customer per
   * review, server-enforced via a junction unique). `auth` defaults to true so the
   * store client attaches the customer access token; no request body is needed —
   * the customer id is pinned from the JWT server-side. A repeat vote is an
   * idempotent 200 returning the current count. Returns the updated helpful count.
   */
  async markReviewHelpful(reviewId: string): Promise<{ id: string; helpfulCount: number } & Record<string, unknown>> {
    return this.request(`/store/reviews/${encodeURIComponent(reviewId)}/helpful`, {
      method: 'POST',
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CART
  //  All cart calls carry BOTH the customer token (if any) and the guest
  //  X-Cart-Token (if any). The backend CartAccessGuard authorizes whichever
  //  identity is present — customer token wins when both are sent.
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Create a fresh guest cart; captures + persists the returned X-Cart-Token.
   *
   * TOKEN-KEY CONTRACT: the backend `POST /api/store/cart`
   * (`CartService.createGuestCart`) returns the raw guest token EXACTLY ONCE. The
   * controller surfaces it directly, but the service-level field name is not
   * pinned from the controller alone, so we read the first of the three documented
   * candidate keys defensively. The chain order is non-load-bearing (only one key
   * is ever populated). TODO: once `CartService.createGuestCart`'s return shape is
   * pinned, narrow this to the single authoritative key.
   */
  async createCart(): Promise<CartResponse> {
    const res = await this.request<
      { cartToken?: string; sessionToken?: string; token?: string } & CartResponse
    >('/store/cart', { method: 'POST', auth: false });
    const token = res.cartToken ?? res.sessionToken ?? res.token ?? null;
    if (token) this.setCartToken(token);
    return res;
  }

  async getCart(): Promise<CartResponse> {
    return this.request('/store/cart', { cartToken: true });
  }

  async addCartItem(body: { skuId: string; qty: number }): Promise<CartResponse> {
    return this.request('/store/cart/items', { method: 'POST', body, cartToken: true });
  }

  async updateCartItem(itemId: string, body: { qty: number }): Promise<CartResponse> {
    return this.request(`/store/cart/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body,
      cartToken: true,
    });
  }

  async removeCartItem(itemId: string): Promise<CartResponse> {
    return this.request(`/store/cart/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      cartToken: true,
    });
  }

  async applyCoupon(body: { code: string }): Promise<CartResponse> {
    return this.request('/store/cart/coupon', { method: 'POST', body, cartToken: true });
  }

  async removeCoupon(): Promise<CartResponse> {
    return this.request('/store/cart/coupon', { method: 'DELETE', cartToken: true });
  }

  /**
   * Add a DIY guide's purchase set to the cart (BUNDLE or COMPONENTS).
   *
   * Routed to the DiyController endpoint `POST /api/store/diy/:guideId/add-to-cart`
   * (NOT `CartController`'s `/store/cart/diy-bundle`). The DiyController DTO takes
   * `guideId` from the URL param and only `mode` in the body — which is exactly
   * what we send here.
   */
  async addDiyToCart(body: { guideId: string; mode: 'BUNDLE' | 'COMPONENTS' }): Promise<CartResponse> {
    return this.request(`/store/diy/${encodeURIComponent(body.guideId)}/add-to-cart`, {
      method: 'POST',
      body: { mode: body.mode },
      cartToken: true,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CHECKOUT / ORDERS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Place an order. Authorized by the customer token OR the guest X-Cart-Token.
   * On the guest path the response carries a one-time `guestOrderToken` — the
   * caller MUST capture it to view the order / tracking / invoice later.
   */
  async checkout(body: {
    shippingAddress: Record<string, unknown>;
    billingAddress?: Record<string, unknown>;
    guestEmail?: string;
    guestPhone?: string;
  }): Promise<CheckoutResult> {
    return this.request<CheckoutResult>('/store/checkout', {
      method: 'POST',
      body,
      cartToken: true,
    });
  }

  /**
   * Single order detail. DUAL-AUTH: the backend prefers the customer
   * `Authorization` header over the guest `X-Order-Token`. We therefore send the
   * customer token (auth defaults to true) ONLY when no guest token is supplied;
   * when a `guestToken` IS passed we explicitly disable the customer header so a
   * stale customer token in memory can't shadow the guest credential and make the
   * backend take the (failing) customer path for a guest viewer.
   */
  async getOrder(orderId: string, guestToken?: string): Promise<OrderDetail> {
    return this.request(`/store/orders/${encodeURIComponent(orderId)}`, {
      orderToken: guestToken ?? null,
      auth: !guestToken,
    });
  }

  /** Registered-customer's own orders (requires an active customer session). */
  async myOrders(params: Record<string, unknown> = {}): Promise<OrderListResponse> {
    return this.request(`/store/orders${this.qs(params)}`);
  }

  async getOrderTracking(orderId: string, guestToken?: string): Promise<OrderTracking> {
    return this.request(`/store/orders/${encodeURIComponent(orderId)}/tracking`, {
      orderToken: guestToken ?? null,
      auth: !guestToken,
    });
  }

  async getOrderInvoiceUrl(orderId: string, guestToken?: string): Promise<OrderInvoice> {
    return this.request(`/store/orders/${encodeURIComponent(orderId)}/invoice`, {
      orderToken: guestToken ?? null,
      auth: !guestToken,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ARTICLES (public + author)
  // ════════════════════════════════════════════════════════════════════════

  async listArticles(params: Record<string, unknown> = {}): Promise<ArticleListResponse> {
    return this.request(`/articles${this.qs(params)}`, { auth: false });
  }

  async getArticle(slug: string): Promise<ArticleDetail> {
    return this.request(`/articles/${encodeURIComponent(slug)}`, { auth: false });
  }

  async getRelatedArticles(slug: string): Promise<ArticleSummary[]> {
    return this.request(`/articles/${encodeURIComponent(slug)}/related`, { auth: false });
  }

  /** Create a new article straight into the moderation queue (status SUBMITTED). */
  async submitArticle(body: Record<string, unknown>): Promise<ArticleDetail> {
    return this.request('/articles', { method: 'POST', body });
  }

  /**
   * Create a new article as a DRAFT (work-in-progress; NOT submitted for review).
   * The author can keep editing it (updateMyArticle) and later submit it via
   * submitArticleForReview. Distinct from submitArticle, which queues for review.
   */
  async saveArticleDraft(body: Record<string, unknown>): Promise<ArticleDetail> {
    return this.request('/articles/draft', { method: 'POST', body });
  }

  /**
   * Submit an existing DRAFT (or REJECTED) article for review
   * (-> SUBMITTED). Optional inline edits in `body` are applied first
   * (save-then-submit in one call).
   */
  async submitArticleForReview(
    id: string,
    body: Record<string, unknown> = {},
  ): Promise<ArticleDetail> {
    return this.request(`/articles/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      body,
    });
  }

  async myArticles(params: Record<string, unknown> = {}): Promise<ArticleListResponse> {
    return this.request(`/articles/mine${this.qs(params)}`);
  }

  async updateMyArticle(id: string, body: Record<string, unknown>): Promise<ArticleDetail> {
    return this.request(`/articles/${encodeURIComponent(id)}`, { method: 'PATCH', body });
  }

  async presignArticleMedia(
    id: string,
    body: { type: MediaType; fileName: string; mimeType: string; caption?: string },
  ): Promise<{ uploadUrl: string; mediaId: string } & Record<string, unknown>> {
    return this.request(`/articles/${encodeURIComponent(id)}/media/presign`, { method: 'POST', body });
  }

  async confirmArticleMedia(
    id: string,
    mediaId: string,
    body: { caption?: string; sortOrder?: number; fileSize?: number } = {},
  ): Promise<unknown> {
    return this.request(
      `/articles/${encodeURIComponent(id)}/media/${encodeURIComponent(mediaId)}/confirm`,
      { method: 'POST', body },
    );
  }

  async deleteArticleMedia(id: string, mediaId: string): Promise<unknown> {
    return this.request(
      `/articles/${encodeURIComponent(id)}/media/${encodeURIComponent(mediaId)}`,
      { method: 'DELETE' },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  //  S3 PRESIGNED UPLOAD HELPER
  //  Used by MediaUploader: PUT the file bytes to the presigned URL with the
  //  exact Content-Type that was signed. This call goes to S3 directly (absolute
  //  URL), bypassing API_BASE and never attaching the customer token.
  // ════════════════════════════════════════════════════════════════════════

  async uploadToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
    // NOTE: intentional bare fetch — do NOT route through the request() wrapper or
    // API_BASE. A presigned S3 PUT goes to the AWS endpoint (absolute URL) and must
    // carry ONLY the exact Content-Type that was signed; attaching API_BASE, the
    // customer Authorization header, or our JSON Content-Type would break the
    // signature and S3 would reject the upload. A future reviewer "fixing" this to
    // use the wrapper would break all media uploads.
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!res.ok) {
      throw new ApiError(res.status, `Upload failed (HTTP ${res.status})`);
    }
  }
}

export const storeApi = new StoreApiClient();
export type { StoreApiClient };
