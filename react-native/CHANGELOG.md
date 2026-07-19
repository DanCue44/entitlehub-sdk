# Changelog

## 0.1.2 — 2026-07-18

### Added
- `configureEntitleHub({ iap })` — inject the OpenIAP-compatible store module (pinned expo-iap
  version, or react-native-iap) instead of the hard-coded `expo-iap`. Decouples this SDK from a
  single store-library version so you can work around a native issue without changing the SDK.

### Docs
- Note that native store-library crashes (e.g. `EXC_BAD_ACCESS` in expo-iap/OpenIAP off the JS
  thread) are a store-library-version concern; how to pin a version, inject a module, or fall back
  to the fully-decoupled `@entitlehub/sdk` + your own billing library.

## 0.1.1 — 2026-07-18

### Fixed
- **`purchaseProduct` crashed** — 0.1.0 was written against expo-iap's old flat `requestPurchase`
  API and read the purchase from the return value. `expo-iap@4.x` is **event-based** with a
  discriminated request. Now: `requestPurchase({ request: { apple: { sku }, google: { skus } },
  type })` with the result bridged from `purchaseUpdatedListener` / `purchaseErrorListener`.
- Android subscriptions now pass the required `offerToken` (fetched from the product).
- `getProducts` uses expo-iap's `fetchProducts` (the old `getProducts` no longer exists).

## 0.1.0 — 2026-07-18

Initial release.

- `configureEntitleHub`, `purchaseProduct` (native sheet → validate → entitlements),
  `restorePurchases`, `getCustomerInfo`, `isEntitled`, `getOfferings`, `getProducts`, `logIn`,
  `addCustomerInfoUpdateListener`.
- Wraps `expo-iap` (peer) for the store purchase and `@entitlehub/sdk` for the entitlement layer.
  Publishable-key only; receipts validated server-side by EntitleHub.
