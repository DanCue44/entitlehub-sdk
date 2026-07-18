# @entitlehub/sdk

[![npm version](https://img.shields.io/npm/v/@entitlehub/sdk)](https://www.npmjs.com/package/@entitlehub/sdk)
[![types included](https://img.shields.io/npm/types/@entitlehub/sdk)](https://www.npmjs.com/package/@entitlehub/sdk)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@entitlehub/sdk)
[![license MIT](https://img.shields.io/npm/l/@entitlehub/sdk)](./LICENSE)

One entitlement API across **App Store, Google Play, Stripe, and web** — for browsers, React Native, Expo, and Node. Stop checking raw product IDs; ask *"what is this user entitled to right now?"*

> Docs: **[entitlehub.com/docs](https://entitlehub.com/docs)** · [REST API](https://entitlehub.com/docs/api) · [Migrating from RevenueCat](https://entitlehub.com/docs/migrating-from-revenuecat)

```bash
npm install @entitlehub/sdk
```

Zero dependencies. Uses the global `fetch` (Node 18+, all modern browsers, React Native, Expo).

## Client (in your app) — publishable key

Reads only. Safe to ship in your app. **Never put a secret (`sk_`) key here.**

```ts
import { EntitleHub } from "@entitlehub/sdk";

const eh = new EntitleHub({
  apiKey: "pk_live_…",     // your publishable key
  appUserId: user.id,      // your own stable user id
});

const info = await eh.getCustomerInfo();
if (info.isActive("pro")) {
  unlockProFeatures();
}

// full detail when you need it
const pro = info.active["pro"];
// → { entitlement: "pro", status: "active", store: "app_store", expires_at, will_renew, … }
```

### React / React Native

```tsx
const eh = new EntitleHub({ apiKey: "pk_live_…", appUserId: user.id });

useEffect(() => {
  const unsub = eh.addCustomerInfoUpdateListener((info) => setPro(info.isActive("pro")));
  eh.getCustomerInfo();               // triggers the listener
  return unsub;
}, []);
```

### After your own login / logout

```ts
await eh.logIn(newUserId);   // switches user, refreshes, clears cache
eh.logOut();                 // forget cached info
```

### API (client)

| Method | Returns | Notes |
|---|---|---|
| `getCustomerInfo({ fetchPolicy })` | `CustomerInfo` | `cache-first` (default) or `network-only`. Cached `cacheTtlMs` (5 min default). |
| `isEntitled(id)` | `boolean` | Convenience over cached info. |
| `checkEntitlement(id)` | `CheckResult` | Always hits the server; includes a `reason` when inactive. |
| `getOfferings()` | `Offerings` | Entitlements + products, for building a paywall. |
| `addCustomerInfoUpdateListener(fn)` | `() => void` | Returns an unsubscribe. |

## Server (in your backend) — secret key

Report purchases and grant entitlements. **Server only.**

```ts
import { EntitleHubServer } from "@entitlehub/sdk";

const eh = new EntitleHubServer({ apiKey: process.env.ENTITLEHUB_SECRET_KEY! });

// After the store purchase is confirmed on-device, report it from your server.
// Google Play — validated (EntitleHub verifies the token with your Play service account):
const info = await eh.reportPurchase(userId, {
  store: "play", storeProductId: "pro_monthly",
  purchaseToken: playToken, isSubscription: true,
});
info.isActive("pro"); // → true

// Apple StoreKit 2 — validated (product / environment read from the signed JWS):
await eh.reportPurchase(userId, { store: "app_store", storeProductId: "", signedTransaction: jws });

// Trusted server-report (no store validation — only if you validated the receipt elsewhere):
await eh.reportPurchase(userId, { store: "app_store", storeProductId: "pro_monthly" });

// Grant directly (promo / comp / support), no purchase:
await eh.grantEntitlement(userId, "pro", { durationDays: 30 });
```

| Method | Returns |
|---|---|
| `reportPurchase(userId, { store, storeProductId, purchaseToken?, isSubscription?, signedTransaction?, isSandbox?, transactionId? })` | `CustomerInfo` |
| `grantEntitlement(userId, id, { durationDays?, isSandbox? })` | `CustomerInfo` |
| `getCustomerInfo(userId)` / `check(userId, id)` | `CustomerInfo` / `CheckResult` |

## Already have an IAP setup?

Keep making the actual store purchase with your existing IAP flow (StoreKit / Play Billing /
`expo-iap` / `react-native-iap`), then `reportPurchase(...)` from your server and read entitlements
with `getCustomerInfo()`. See the full guide at [entitlehub.com/docs](https://entitlehub.com).

## Errors

Every failure throws an `EntitleHubError` with `.status` and `.code` (`auth` | `http` | `network` | `config`).

```ts
import { EntitleHubError } from "@entitlehub/sdk";
try { await eh.getCustomerInfo(); }
catch (e) { if (e instanceof EntitleHubError && e.code === "auth") relogin(); }
```

## Self-hosting

Point the SDK at your own EntitleHub with `baseUrl`:

```ts
new EntitleHub({ apiKey, appUserId, baseUrl: "https://entitlements.yourco.com/v1" });
```
