# @entitlehub/react-native

[![npm version](https://img.shields.io/npm/v/@entitlehub/react-native)](https://www.npmjs.com/package/@entitlehub/react-native)
[![license MIT](https://img.shields.io/npm/l/@entitlehub/react-native)](./LICENSE)

EntitleHub for **React Native & Expo** — one call to purchase and unlock entitlements. It opens the
native store sheet (via [`expo-iap`](https://github.com/hyochan/expo-iap)), validates the receipt
with EntitleHub server-side, and hands you the updated entitlements. The RevenueCat developer
experience, on EntitleHub.

```bash
npx expo install expo-iap
npm install @entitlehub/react-native @entitlehub/sdk
```

## Use

```ts
import {
  configureEntitleHub, purchaseProduct, getCustomerInfo, restorePurchases, isEntitled,
} from "@entitlehub/react-native";

// once, after your own login:
await configureEntitleHub({ apiKey: "pk_live_…", appUserId: user.id });

// gate a feature:
if (await isEntitled("pro")) unlockPro();

// buy — opens the native sheet, validates, returns entitlements:
const info = await purchaseProduct("app_pro_monthly", { isSubscription: true });
if (info.isActive("pro")) unlockPro();

// restore:
const restored = await restorePurchases();
```

| Function | What it does |
|---|---|
| `configureEntitleHub({ apiKey, appUserId, baseUrl? })` | Configure + open the store connection. |
| `purchaseProduct(productId, { isSubscription? })` | Native purchase → validate with EntitleHub → returns `CustomerInfo`. |
| `restorePurchases()` | Re-validate the store's purchases, return `CustomerInfo`. |
| `getCustomerInfo()` / `isEntitled(id)` | Read entitlements. |
| `getOfferings()` / `getProducts(ids)` | Catalog metadata / live store prices. |
| `logIn(appUserId)` | Switch the acting user. |
| `addCustomerInfoUpdateListener(fn)` | React to entitlement changes. |

Only your **publishable** key (`pk_`) ships in the app. EntitleHub validates the Apple/Google
receipt server-side, so a forged one is rejected — no secret key on the device.

## How it works

`purchaseProduct` calls `expo-iap` to open the StoreKit / Play Billing sheet, then reports the
resulting receipt to EntitleHub: the iOS StoreKit 2 JWS, or the Android purchase token. EntitleHub
verifies it (Apple root CA / Google Play API), writes the entitlement grant, and returns the
customer info. Renewals/refunds stay current via
[server-to-server notifications](https://entitlehub.com/docs/store-credentials).

Full guide: **[entitlehub.com/docs/purchases](https://entitlehub.com/docs/purchases)**.

> Requires a development build (Expo Go has no in-app-purchase native module). The entitlement layer
> is [`@entitlehub/sdk`](https://www.npmjs.com/package/@entitlehub/sdk); this package adds the
> purchase flow on top.
