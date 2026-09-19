import { EntitleHub } from "@entitlehub/sdk";
import type { CustomerInfo, Offerings } from "@entitlehub/sdk";

// `require` is ambient in React Native (Metro) and Node, declare it so this builds without @types/node.
declare const require: (module: string) => any;

// expo-iap is a peer dependency, lazily required so this package builds without it and gives a clear
// error at runtime if it's missing.
type ExpoIap = any;
let _iap: ExpoIap | undefined;
function iap(): ExpoIap {
  if (_iap) return _iap;
  try {
    _iap = require("expo-iap");
  } catch {
    throw new Error("@entitlehub/react-native needs 'expo-iap'. Install it with:  npx expo install expo-iap");
  }
  return _iap;
}

// Kept in sync with package.json on release; reported to EntitleHub so the dashboard can flag an
// out-of-date SDK instead of the customer discovering it via a bug that's already fixed.
const RN_SDK_VERSION = "0.1.7";

let client: EntitleHub | undefined;
function eh(): EntitleHub {
  if (!client) throw new Error("Call configureEntitleHub({ apiKey, appUserId }) before using EntitleHub.");
  return client;
}

export interface ConfigureOptions {
  /** Your EntitleHub publishable key (pk_live_… / pk_test_…). Client-safe. */
  apiKey: string;
  /** Your own stable user id. */
  appUserId: string;
  /** Override the API base (self-host). */
  baseUrl?: string;
  /**
   * The in-app-purchase module to use. Must implement the OpenIAP API (`initConnection`,
   * `fetchProducts`, `requestPurchase`, `purchaseUpdatedListener`, `purchaseErrorListener`,
   * `finishTransaction`, `getAvailablePurchases`). Defaults to `expo-iap`.
   *
   * Pass your own if you need a specific version or a different OpenIAP-compatible library, e.g.
   * `iap: require("expo-iap")` with a pinned version, or `react-native-iap`. Useful to work around
   * a native issue in a particular store-library version without changing this SDK.
   */
  iap?: unknown;
}

/** Configure EntitleHub and open the store connection. Call once at startup (after your own login). */
export async function configureEntitleHub(opts: ConfigureOptions): Promise<void> {
  if (opts.iap) _iap = opts.iap;
  client = new EntitleHub({
    apiKey: opts.apiKey,
    appUserId: opts.appUserId,
    baseUrl: opts.baseUrl,
    client: `react-native/${RN_SDK_VERSION}`,
  });
  try {
    await iap().initConnection();
  } catch {
    /* the store may be unavailable in a simulator / dev client, purchases will surface the error */
  }
}

/** Switch the acting user after your own login. Returns their entitlements. */
export async function logIn(appUserId: string): Promise<CustomerInfo> {
  return eh().logIn(appUserId);
}

/** The current user's entitlements (cached; RC-style CustomerInfo). */
export async function getCustomerInfo(): Promise<CustomerInfo> {
  return eh().getCustomerInfo();
}

/** Convenience: is the user entitled right now? */
export async function isEntitled(entitlementId: string): Promise<boolean> {
  return eh().isEntitled(entitlementId);
}

/** Your EntitleHub catalog (entitlements + products) for building a paywall. */
export async function getOfferings(): Promise<Offerings> {
  return eh().getOfferings();
}

/** Live store products (prices, localized titles) from the native store (expo-iap `fetchProducts`). */
export async function getProducts(productIds: string[], type: "in-app" | "subs" | "all" = "all"): Promise<any[]> {
  return iap().fetchProducts({ skus: productIds, type });
}

/** How long to wait for the store's result once the request is actually in flight. */
const DEFAULT_PURCHASE_TIMEOUT_MS = 120_000;
/** Absolute backstop from the call: covers the user sitting in Apple's password / Face ID sheet. */
const DEFAULT_SHEET_TIMEOUT_MS = 600_000;
/** How long to keep polling for confirmation before giving up. */
const DEFAULT_RECONCILE_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Why a purchase didn't complete. Check `code`, never match on the message. */
export type PurchaseErrorCode = "purchase-cancelled" | "purchase-pending" | "purchase-failed";

/**
 * A purchase that didn't return entitlements.
 *
 * `code === "purchase-pending"` is NOT a failure: the store took the money but confirmation hasn't
 * reached us yet (store notifications are asynchronous). Show "still confirming", not an error,
 * the entitlement will arrive on its own, and `addCustomerInfoUpdateListener` will fire when it does.
 */
export class PurchaseError extends Error {
  readonly code: PurchaseErrorCode;
  /** True when the purchase probably succeeded and is just unconfirmed. */
  readonly pending: boolean;
  /** Last known entitlements, if we managed to read them. */
  readonly customerInfo?: CustomerInfo;
  constructor(code: PurchaseErrorCode, message: string, customerInfo?: CustomerInfo) {
    super(message);
    this.name = "PurchaseError";
    this.code = code;
    this.pending = code === "purchase-pending";
    this.customerInfo = customerInfo;
  }
}

/**
 * Buy a product in one call: open the native purchase sheet, validate the receipt with EntitleHub,
 * and return the updated entitlements. Purchase + entitlement sync, the RevenueCat way.
 *
 * Store bridges disagree about how the result comes back, so we accept it from any source and never
 * hang waiting for one of them:
 *  1. `purchaseUpdatedListener`: expo-iap's event-based flow.
 *  2. `requestPurchase`'s resolved value: react-native-iap 15+ / Nitro resolves with the purchase
 *     and may never emit the event.
 *  3. Reconciliation after `timeoutMs`: re-read `getAvailablePurchases()`, and failing that check
 *     whether the entitlement appeared server-side anyway (EntitleHub's store-notification webhook
 *     grants it independently of the client).
 *
 * Rejects with a `PurchaseError`; branch on `.code`, never the message:
 *   - `purchase-cancelled`: the user backed out.
 *   - `purchase-pending`  : the store took the money but hasn't confirmed. NOT a failure; show a
 *                            pending state. `.pending` is true and the entitlement will land on its own.
 *   - `purchase-failed`   : a real failure.
 */
export async function purchaseProduct(
  productId: string,
  opts: {
    isSubscription?: boolean;
    isConsumable?: boolean;
    /** Wait for the store's result once the request is in flight (default 120s). */
    timeoutMs?: number;
    /** Absolute backstop from the call, covering time spent in the store's own sheet (default 10m). */
    sheetTimeoutMs?: number;
    /** How long to poll for confirmation before reporting pending (default 30s). */
    reconcileMs?: number;
  } = {},
): Promise<CustomerInfo> {
  const I = iap();
  const isSub = Boolean(opts.isSubscription);
  const isConsumable = Boolean(opts.isConsumable) && !isSub;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PURCHASE_TIMEOUT_MS;
  const sheetTimeoutMs = opts.sheetTimeoutMs ?? DEFAULT_SHEET_TIMEOUT_MS;
  const reconcileMs = opts.reconcileMs ?? DEFAULT_RECONCILE_MS;

  // Snapshot entitlements before buying (cached, no network). If we later have to reconcile, a
  // grown set is proof the purchase landed even though the client never heard about it.
  let entitlementsBefore: string[] = [];
  try {
    entitlementsBefore = (await eh().getCustomerInfo()).activeEntitlementIds;
  } catch {
    /* first run / offline: reconciliation just falls back to the store's own record */
  }

  // Base request. Android subscriptions additionally need an offer token from the product.
  const request: any = { apple: { sku: productId }, google: { skus: [productId] } };
  if (isSub) {
    try {
      const products = await I.fetchProducts({ skus: [productId], type: "subs" });
      const product = Array.isArray(products) ? products.find((p: any) => (p?.id ?? p?.productId) === productId) : undefined;
      const offer = product?.subscriptionOfferDetailsAndroid?.[0] ?? product?.subscriptionOfferDetails?.[0];
      if (offer?.offerToken) {
        request.google = { skus: [productId], subscriptionOffers: [{ sku: productId, offerToken: offer.offerToken }] };
      }
    } catch {
      /* iOS (no Android offers) or fetch failed: proceed; iOS subs don't need an offer token */
    }
  }

  return new Promise<CustomerInfo>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      try { updSub?.remove(); } catch { /* noop */ }
      try { errSub?.remove(); } catch { /* noop */ }
      if (timer) clearTimeout(timer);
    };

    const fail = (e: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e);
    };

    // Validate + acknowledge a purchase, wherever we got it from.
    const settleWithPurchase = async (purchase: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        const info = await reportToEntitleHub(purchase, productId, isSub);
        // Consumables (e.g. per-game passes) must be consumed or the store
        // treats them as owned and blocks repurchase.
        try { await I.finishTransaction({ purchase, isConsumable }); } catch { /* best-effort ack */ }
        resolve(info);
      } catch (e) {
        reject(e);
      }
    };

    // Does this look like a real purchase payload (vs. a bare ack / void)?
    const isPurchase = (p: any) =>
      Boolean(p) && Boolean(p.purchaseToken || p.jwsRepresentation || p.jwsRepresentationIos ||
        p.purchaseTokenAndroid || p.transactionId || p.transactionReceipt || p.id);

    // Nothing arrived in time. The money may still have moved, so POLL rather than take one reading:
    // the store's own record and EntitleHub's webhook are both asynchronous, and a single check at
    // an arbitrary instant loses that race (observed live, the grant landed seconds after the check).
    const reconcile = async () => {
      const deadline = Date.now() + reconcileMs;
      let wait = 2_000;
      let lastInfo: CustomerInfo | undefined;

      while (!settled) {
        try {
          const owned: any[] = (await I.getAvailablePurchases()) || [];
          const match = owned.find((p) => (p?.productId ?? p?.id ?? p?.sku) === productId);
          if (match) return settleWithPurchase(match);
        } catch { /* store unavailable: try the server */ }

        try {
          lastInfo = await eh().getCustomerInfo({ fetchPolicy: "network-only" });
          if (lastInfo.activeEntitlementIds.some((id) => !entitlementsBefore.includes(id))) {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(lastInfo);
            return;
          }
        } catch { /* offline: keep trying until the deadline */ }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(wait, remaining));
        wait = Math.min(wait * 1.5, 8_000);
      }

      fail(new PurchaseError(
        "purchase-pending",
        "The store hasn't confirmed this purchase yet. It may still complete, show a pending state, not a failure.",
        lastInfo,
      ));
    };

    const armTimer = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void reconcile(); }, ms);
    };

    const updSub = I.purchaseUpdatedListener((purchase: any) => { void settleWithPurchase(purchase); });

    const errSub = I.purchaseErrorListener((error: any) => {
      const code = error?.code;
      const cancelled = code === "E_USER_CANCELLED" || code === "user-cancelled" || /cancel/i.test(String(error?.message));
      fail(cancelled
        ? new PurchaseError("purchase-cancelled", "The user cancelled the purchase.")
        : new PurchaseError("purchase-failed", error?.message || "The purchase failed."));
    });

    // react-native-iap 15+ (Nitro) resolves this with the purchase itself and may never fire
    // purchaseUpdatedListener, so the resolved value has to be honoured, not discarded.
    Promise.resolve(
      I.requestPurchase({ request, type: isSub ? "subs" : "in-app" }),
    ).then((res: any) => {
      const p = Array.isArray(res) ? res.find(isPurchase) : res;
      if (isPurchase(p)) { void settleWithPurchase(p); return; }
      // The sheet is no longer ours to wait on: only now does "how long is the store taking?"
      // mean anything. Before this, the clock was counting the user typing their password.
      armTimer(timeoutMs);
    }).catch((e: any) => fail(
      e instanceof PurchaseError ? e : new PurchaseError("purchase-failed", e?.message || "The purchase failed."),
    ));

    // Backstop so a bridge that never settles can't hang forever. Generous: the user may be sitting
    // in Apple's password / Face ID sheet, which is their time, not the store's.
    armTimer(sheetTimeoutMs);
  });
}

/** Restore the user's purchases: re-validate each with EntitleHub, then return entitlements. */
export async function restorePurchases(): Promise<CustomerInfo> {
  const I = iap();
  const purchases: any[] = (await I.getAvailablePurchases()) || [];
  for (const p of purchases) {
    await reportToEntitleHub(p, p.productId ?? p.id ?? p.sku, true).catch(() => {});
  }
  return eh().getCustomerInfo({ fetchPolicy: "network-only" });
}

/** Subscribe to entitlement changes (e.g. after a purchase). Returns an unsubscribe function. */
export function addCustomerInfoUpdateListener(fn: (info: CustomerInfo) => void): () => void {
  return eh().addCustomerInfoUpdateListener(fn);
}

// Map an OpenIAP Purchase to an EntitleHub validated report (iOS StoreKit 2 JWS / Android token).
// expo-iap exposes the iOS JWS as jwsRepresentation(-Ios); react-native-iap 15+ (Nitro) uses the
// unified purchaseToken field for BOTH platforms (iOS JWS / Android token), discriminated by
// purchase.platform: without the platform check, an iOS receipt gets misreported as a Play token.
async function reportToEntitleHub(purchase: any, productId: string, isSubscription?: boolean): Promise<CustomerInfo> {
  const jws =
    purchase?.jwsRepresentation ??
    purchase?.jwsRepresentationIos ??
    (String(purchase?.platform).toLowerCase() === "ios" ? purchase?.purchaseToken : undefined);
  if (jws) return eh().reportPurchase({ signedTransaction: jws });

  const token = purchase?.purchaseTokenAndroid ?? purchase?.purchaseToken;
  if (token) {
    return eh().reportPurchase({
      store: "play",
      storeProductId: productId,
      purchaseToken: token,
      isSubscription: Boolean(isSubscription),
    });
  }
  throw new Error("Could not read a receipt from the purchase (no iOS JWS or Android purchase token).");
}

export type { CustomerInfo, Offerings } from "@entitlehub/sdk";
