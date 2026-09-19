# Changelog

## 0.1.7 (2026-07-22)

### Fixed
- **A completed purchase could still be reported as failed.** After a timeout, `purchaseProduct()`
  checked for confirmation exactly once. Store notifications are asynchronous, so that single
  reading races the grant and sometimes loses, observed live: the entitlement was written seconds
  after the check ran, and the user saw a purchase-failed error for a purchase that worked. It now
  polls the store and the server with backoff (`reconcileMs`, default 30s) before giving up.
- **The timeout counted the user's own time.** The timer was armed when `purchaseProduct()` was
  called: before the store's password / Face ID sheet appears, so a user who paused mid-purchase
  tripped it. It now starts once the request is actually in flight, with a separate generous
  backstop (`sheetTimeoutMs`, default 10m) so a stuck bridge still can't hang forever.

### Changed
- **Rejections are now typed `PurchaseError`s: branch on `.code`, not the message.**
  `purchase-cancelled`, `purchase-failed`, and the new `purchase-pending`. **`purchase-pending` is
  not a failure**: the store took the money but hasn't confirmed yet. Show "still confirming", the
  entitlement lands on its own and `addCustomerInfoUpdateListener` fires when it does. `.pending`
  and `.customerInfo` are on the error. The old untyped `"purchase-timeout"` message is gone.

## 0.1.6 (2026-07-21)

### Added
- Reports `react-native/<version>` to EntitleHub on each call, so the dashboard can tell you when
  your SDK is behind a release with fixes in it, rather than you finding out by hitting the bug.
  Version only; no device or user data.

## 0.1.5 (2026-07-21)

### Fixed
- **`purchaseProduct()` could hang forever after a successful purchase.** It waited only on
  `purchaseUpdatedListener`; on the react-native-iap 15+ / Nitro bridge that callback never fires,
  so the promise never settled: the paywall stayed open and features stayed locked even though the
  user had been charged and EntitleHub had already granted the entitlement server-side.
  `requestPurchase`'s resolved value was being discarded entirely; it is now honoured, so bridges
  that resolve instead of emitting an event work.

### Added
- Reconciliation safety net: if no result arrives within `timeoutMs` (default 120s),
  `purchaseProduct()` re-reads `getAvailablePurchases()` and, failing that, re-checks entitlements
  from the server: resolving successfully if the entitlement appeared while the client was waiting.
  Only rejects (`"purchase-timeout"`) when nothing was actually granted.
- `purchaseProduct(id, { timeoutMs })` to tune that window.

## 0.1.2 (2026-07-18)

### Added
- `configureEntitleHub({ iap })`: inject the OpenIAP-compatible store module (pinned expo-iap
  version, or react-native-iap) instead of the hard-coded `expo-iap`. Decouples this SDK from a
  single store-library version so you can work around a native issue without changing the SDK.

### Docs
- Note that native store-library crashes (e.g. `EXC_BAD_ACCESS` in expo-iap/OpenIAP off the JS
  thread) are a store-library-version concern; how to pin a version, inject a module, or fall back
  to the fully-decoupled `@entitlehub/sdk` + your own billing library.

## 0.1.1 (2026-07-18)

### Fixed
- **`purchaseProduct` crashed**: 0.1.0 was written against expo-iap's old flat `requestPurchase`
  API and read the purchase from the return value. `expo-iap@4.x` is **event-based** with a
  discriminated request. Now: `requestPurchase({ request: { apple: { sku }, google: { skus } },
  type })` with the result bridged from `purchaseUpdatedListener` / `purchaseErrorListener`.
- Android subscriptions now pass the required `offerToken` (fetched from the product).
- `getProducts` uses expo-iap's `fetchProducts` (the old `getProducts` no longer exists).

## 0.1.0 (2026-07-18)

Initial release.

- `configureEntitleHub`, `purchaseProduct` (native sheet → validate → entitlements),
  `restorePurchases`, `getCustomerInfo`, `isEntitled`, `getOfferings`, `getProducts`, `logIn`,
  `addCustomerInfoUpdateListener`.
- Wraps `expo-iap` (peer) for the store purchase and `@entitlehub/sdk` for the entitlement layer.
  Publishable-key only; receipts validated server-side by EntitleHub.
