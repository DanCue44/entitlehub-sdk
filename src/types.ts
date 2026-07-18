// Wire types — these mirror the EntitleHub public API (/v1) responses exactly.

export type Store = "app_store" | "play" | "stripe" | "web" | "amazon";
export type EntitlementStatus = "active" | "trial" | "grace" | "expired" | "revoked";

/** One entitlement a subscriber currently holds (from GET /v1/subscribers/{id}). */
export interface ActiveEntitlement {
  entitlement: string;
  status: EntitlementStatus | string;
  store: Store | string;
  product: string;
  expires_at: string | null;
  will_renew: boolean;
  since: string | null;
}

/** Raw customer payload from the API. */
export interface CustomerInfoResponse {
  app_user_id: string;
  active_entitlements: ActiveEntitlement[];
}

/** Result of POST /v1/check for a single entitlement. */
export interface CheckResult {
  app_user_id: string;
  entitlement: string;
  active: boolean;
  status?: string;
  store?: string;
  product?: string;
  expires_at?: string;
  will_renew: boolean;
  since?: string;
  /** When inactive, why: unknown_entitlement | unknown_subscriber | no_active_grant. */
  reason?: string;
}

export interface OfferingEntitlement {
  id: string;
  key: string;
  name: string;
  description: string;
  active_count: number;
  product_count: number;
  stores: Store[];
}

export interface OfferingProduct {
  id: string;
  store: Store;
  store_product_id: string;
  type: "subscription" | "non_consumable" | "consumable" | string;
  duration: string;
  display_name: string;
  price_micros: number;
  currency: string;
  entitlements: string[];
}

export interface Offerings {
  entitlements: OfferingEntitlement[];
  products: OfferingProduct[];
}

export interface PurchaseInput {
  store: Store;
  storeProductId: string;
  isSandbox?: boolean;
  transactionId?: string;
  /**
   * Google Play purchase token. When set, EntitleHub validates it against the project's
   * Play service account before granting (the authenticated expiry wins). Pair with
   * `isSubscription` for auto-renewable products.
   */
  purchaseToken?: string;
  /** Google Play: true for an auto-renewable subscription, false/omit for a one-time product. */
  isSubscription?: boolean;
  /**
   * Apple StoreKit 2 signed transaction (JWS). When set, EntitleHub verifies it against
   * Apple's root CA; the authenticated product id / environment override `store` /
   * `storeProductId`, so a client can't forge a purchase.
   */
  signedTransaction?: string;
  /**
   * Stripe subscription id. When set, EntitleHub validates it against the project's Stripe
   * secret key (active/trialing → granted, with the current period end as the expiry).
   */
  stripeSubscriptionId?: string;
}
