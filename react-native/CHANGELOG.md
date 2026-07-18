# Changelog

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
