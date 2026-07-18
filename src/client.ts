import { CustomerInfo } from "./customer-info.js";
import { EntitleHubError, request, type HttpOptions } from "./http.js";
import type { CheckResult, CustomerInfoResponse, Offerings, Store } from "./types.js";

export interface EntitleHubOptions {
  /** Your publishable key (pk_live_… / pk_test_…). Client-safe. */
  apiKey: string;
  /** The user this device is acting as (your own stable user id). */
  appUserId: string;
  /** Override the API base (defaults to https://entitlehub.com/v1). */
  baseUrl?: string;
  /** Custom fetch (Node <18, tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** How long a cached CustomerInfo is considered fresh, ms (default 5 min). */
  cacheTtlMs?: number;
}

export type CustomerInfoListener = (info: CustomerInfo) => void;
export type FetchPolicy = "cache-first" | "network-only";

/**
 * The client-side EntitleHub SDK — configure once, then ask "what is this user entitled to?".
 * Safe for browsers, React Native, and Expo (publishable key only; never ship a secret key).
 *
 *   const eh = new EntitleHub({ apiKey: "pk_live_…", appUserId: user.id });
 *   const info = await eh.getCustomerInfo();
 *   if (info.isActive("pro")) unlockPro();
 */
export class EntitleHub {
  private http: HttpOptions;
  private appUserId: string;
  private cacheTtlMs: number;
  private cached?: { info: CustomerInfo; at: number };
  private listeners = new Set<CustomerInfoListener>();

  constructor(opts: EntitleHubOptions) {
    if (!opts.apiKey) throw new EntitleHubError("apiKey is required.", 0, "config");
    if (!opts.appUserId) throw new EntitleHubError("appUserId is required.", 0, "config");
    if (opts.apiKey.startsWith("sk_")) {
      throw new EntitleHubError("Never use a secret (sk_) key in the client SDK — use your publishable (pk_) key.", 0, "config");
    }
    this.appUserId = opts.appUserId;
    this.cacheTtlMs = opts.cacheTtlMs ?? 5 * 60_000;
    this.http = { baseUrl: opts.baseUrl ?? "https://entitlehub.com/v1", apiKey: opts.apiKey, fetchImpl: opts.fetchImpl, timeoutMs: 15_000 };
  }

  /** The current app user id. */
  get currentAppUserId(): string {
    return this.appUserId;
  }

  /** Switch the acting user (e.g. after your own login). Clears the cache. */
  async logIn(appUserId: string): Promise<CustomerInfo> {
    this.appUserId = appUserId;
    this.cached = undefined;
    return this.getCustomerInfo({ fetchPolicy: "network-only" });
  }

  /** Forget the cached user's info. Pair with your own logout. */
  logOut(): void {
    this.cached = undefined;
  }

  /** The subscriber's active entitlements. Cached for `cacheTtlMs`; pass network-only to force a refresh. */
  async getCustomerInfo(opts: { fetchPolicy?: FetchPolicy } = {}): Promise<CustomerInfo> {
    const policy = opts.fetchPolicy ?? "cache-first";
    if (policy === "cache-first" && this.cached && Date.now() - this.cached.at < this.cacheTtlMs) {
      return this.cached.info;
    }
    const raw = await request<CustomerInfoResponse>(this.http, "GET", `/subscribers/${encodeURIComponent(this.appUserId)}`);
    const info = new CustomerInfo(raw);
    this.cached = { info, at: Date.now() };
    for (const l of this.listeners) { try { l(info); } catch { /* listener errors never break the SDK */ } }
    return info;
  }

  /** Convenience: is this user entitled right now? Uses cached CustomerInfo. */
  async isEntitled(entitlementId: string): Promise<boolean> {
    return (await this.getCustomerInfo()).isActive(entitlementId);
  }

  /** Authoritative single-entitlement check (always hits the server; includes the reason when inactive). */
  async checkEntitlement(entitlementId: string, opts: { sandbox?: boolean } = {}): Promise<CheckResult> {
    return request<CheckResult>(this.http, "POST", "/check", {
      app_user_id: this.appUserId,
      entitlement: entitlementId,
      sandbox: Boolean(opts.sandbox),
    });
  }

  /** The project's entitlements + products — for building a paywall. */
  async getOfferings(): Promise<Offerings> {
    return request<Offerings>(this.http, "GET", "/offerings");
  }

  /**
   * Report a VALIDATED store purchase for the current user and return the updated entitlements.
   * A publishable key can only do validated reports (a forged receipt fails validation):
   *   • Google: { store: "play", storeProductId, purchaseToken, isSubscription: true }
   *   • Apple:  { signedTransaction }
   *   • Stripe: { stripeSubscriptionId }
   * Updates the cache and notifies listeners.
   */
  async reportPurchase(purchase: {
    store?: Store;
    storeProductId?: string;
    purchaseToken?: string;
    isSubscription?: boolean;
    signedTransaction?: string;
    stripeSubscriptionId?: string;
    isSandbox?: boolean;
  }): Promise<CustomerInfo> {
    const raw = await request<CustomerInfoResponse>(this.http, "POST", `/subscribers/${encodeURIComponent(this.appUserId)}/purchases`, {
      store: purchase.store ?? "",
      store_product_id: purchase.storeProductId ?? "",
      is_sandbox: Boolean(purchase.isSandbox),
      purchase_token: purchase.purchaseToken ?? "",
      is_subscription: Boolean(purchase.isSubscription),
      signed_transaction: purchase.signedTransaction ?? "",
      stripe_subscription_id: purchase.stripeSubscriptionId ?? "",
    });
    const info = new CustomerInfo(raw);
    this.cached = { info, at: Date.now() };
    for (const l of this.listeners) { try { l(info); } catch { /* listener errors never break the SDK */ } }
    return info;
  }

  /** Subscribe to CustomerInfo refreshes. Returns an unsubscribe function. */
  addCustomerInfoUpdateListener(listener: CustomerInfoListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
