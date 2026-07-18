import { CustomerInfo } from "./customer-info.js";
import { EntitleHubError, request, type HttpOptions } from "./http.js";
import type { CheckResult, CustomerInfoResponse, PurchaseInput } from "./types.js";

export interface EntitleHubServerOptions {
  /** Your secret key (sk_live_… / sk_test_…). SERVER ONLY — never ship this to a client. */
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * The server-side EntitleHub SDK — report purchases and grant entitlements from your backend.
 * Keep this on your server; it uses a secret key.
 *
 *   const eh = new EntitleHubServer({ apiKey: process.env.ENTITLEHUB_SECRET_KEY! });
 *   await eh.reportPurchase(userId, { store: "app_store", storeProductId: "pro_monthly" });
 */
export class EntitleHubServer {
  private http: HttpOptions;

  constructor(opts: EntitleHubServerOptions) {
    if (!opts.apiKey) throw new EntitleHubError("apiKey is required.", 0, "config");
    if (!opts.apiKey.startsWith("sk_")) {
      throw new EntitleHubError("EntitleHubServer needs a secret (sk_) key. For client reads, use the EntitleHub class with a pk_ key.", 0, "config");
    }
    this.http = { baseUrl: opts.baseUrl ?? "https://entitlehub.com/v1", apiKey: opts.apiKey, fetchImpl: opts.fetchImpl, timeoutMs: 15_000 };
  }

  /**
   * Report a completed store purchase → writes the mapped entitlement grant(s). Returns updated info.
   *
   * Three modes (pick one):
   *   • Google (validated): { store:"play", storeProductId, purchaseToken, isSubscription }
   *   • Apple (validated):  { signedTransaction }   — store/product are read from the JWS
   *   • Stripe (validated): { stripeSubscriptionId } — validated via your Stripe secret key
   *   • Trusted server-report: { store, storeProductId } — no store validation; only when you've
   *     already validated the receipt elsewhere.
   */
  async reportPurchase(appUserId: string, purchase: PurchaseInput): Promise<CustomerInfo> {
    const raw = await request<CustomerInfoResponse>(this.http, "POST", `/subscribers/${encodeURIComponent(appUserId)}/purchases`, {
      store: purchase.store,
      store_product_id: purchase.storeProductId,
      is_sandbox: Boolean(purchase.isSandbox),
      transaction_id: purchase.transactionId ?? "",
      purchase_token: purchase.purchaseToken ?? "",
      is_subscription: Boolean(purchase.isSubscription),
      signed_transaction: purchase.signedTransaction ?? "",
      stripe_subscription_id: purchase.stripeSubscriptionId ?? "",
    });
    return new CustomerInfo(raw);
  }

  /** Grant an entitlement directly (promo / comp / support), no store purchase. */
  async grantEntitlement(appUserId: string, entitlementId: string, opts: { durationDays?: number; isSandbox?: boolean } = {}): Promise<CustomerInfo> {
    const raw = await request<CustomerInfoResponse>(this.http, "POST", `/subscribers/${encodeURIComponent(appUserId)}/grant`, {
      entitlement: entitlementId,
      duration_days: opts.durationDays ?? 0,
      is_sandbox: Boolean(opts.isSandbox),
    });
    return new CustomerInfo(raw);
  }

  /** Read a subscriber's active entitlements. */
  async getCustomerInfo(appUserId: string): Promise<CustomerInfo> {
    const raw = await request<CustomerInfoResponse>(this.http, "GET", `/subscribers/${encodeURIComponent(appUserId)}`);
    return new CustomerInfo(raw);
  }

  /** Authoritative single-entitlement check. */
  async check(appUserId: string, entitlementId: string, opts: { sandbox?: boolean } = {}): Promise<CheckResult> {
    return request<CheckResult>(this.http, "POST", "/check", {
      app_user_id: appUserId,
      entitlement: entitlementId,
      sandbox: Boolean(opts.sandbox),
    });
  }
}
