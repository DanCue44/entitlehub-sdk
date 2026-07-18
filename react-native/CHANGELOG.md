# Changelog

## 0.1.0 — 2026-07-18

Initial release.

- `configureEntitleHub`, `purchaseProduct` (native sheet → validate → entitlements),
  `restorePurchases`, `getCustomerInfo`, `isEntitled`, `getOfferings`, `getProducts`, `logIn`,
  `addCustomerInfoUpdateListener`.
- Wraps `expo-iap` (peer) for the store purchase and `@entitlehub/sdk` for the entitlement layer.
  Publishable-key only; receipts validated server-side by EntitleHub.
