import { EntitleHub } from "@entitlehub/sdk";
import type { CustomerInfo, Offerings } from "@entitlehub/sdk";

// `require` is ambient in React Native (Metro) and Node — declare it so this builds without @types/node.
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
}

/** Configure EntitleHub and open the store connection. Call once at startup (after your own login). */
export async function configureEntitleHub(opts: ConfigureOptions): Promise<void> {
  client = new EntitleHub({ apiKey: opts.apiKey, appUserId: opts.appUserId, baseUrl: opts.baseUrl });
  try {
    await iap().initConnection();
  } catch {
    /* the store may be unavailable in a simulator / dev client — purchases will surface the error */
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

/** Live store products (prices, localized titles) for the given ids, from the native store. */
export async function getProducts(productIds: string[]): Promise<any[]> {
  return iap().getProducts(productIds);
}

/**
 * Buy a product in one call: open the native purchase sheet, validate the receipt with EntitleHub,
 * and return the updated entitlements. Purchase + entitlement sync, the RevenueCat way.
 * Throws "purchase-cancelled" if the user backs out.
 */
export async function purchaseProduct(
  productId: string,
  opts: { isSubscription?: boolean } = {},
): Promise<CustomerInfo> {
  const I = iap();
  const result = await I.requestPurchase({ sku: productId, skus: [productId] });
  const purchase = Array.isArray(result) ? result[0] : result;
  if (!purchase) throw new Error("purchase-cancelled");
  const info = await reportToEntitleHub(purchase, productId, opts.isSubscription);
  try {
    await I.finishTransaction({ purchase, isConsumable: false });
  } catch {
    /* best-effort acknowledgement with the store */
  }
  return info;
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

// Map an expo-iap purchase to an EntitleHub validated report (iOS StoreKit 2 JWS / Android token).
async function reportToEntitleHub(purchase: any, productId: string, isSubscription?: boolean): Promise<CustomerInfo> {
  const jws = purchase?.jwsRepresentationIos ?? purchase?.jwsRepresentation ?? purchase?.verificationResultIos;
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
