# Changelog

All notable changes to `@entitlehub/sdk`. Adheres to [Semantic Versioning](https://semver.org/).

## 0.1.2 — 2026-07-18

### Changed
- The SDK now lives in its own public repository:
  [github.com/DanCue44/entitlehub-sdk](https://github.com/DanCue44/entitlehub-sdk) (MIT). Open-source
  SDK, closed backend. `repository` / `bugs` metadata point there.

## 0.1.1 — 2026-07-18

### Added
- README badges (npm version, types, zero-deps, license) and docs links.
- `LICENSE` (MIT) and this changelog now ship in the package.

### Docs
- `reportPurchase` examples cover all three modes: Google Play (validated via `purchaseToken`
  + `isSubscription`), Apple StoreKit 2 (validated via `signedTransaction`), and trusted
  server-report.

## 0.1.0 — 2026-07-18

Initial release.

- **`EntitleHub`** (client, publishable key) — `getCustomerInfo`, `isEntitled`,
  `checkEntitlement`, `getOfferings`, `logIn` / `logOut`, `addCustomerInfoUpdateListener`.
  Cached CustomerInfo; safe for browsers, React Native, and Expo.
- **`EntitleHubServer`** (server, secret key) — `reportPurchase` (Apple JWS / Google Play
  token / trusted), `grantEntitlement`, `getCustomerInfo`, `check`.
- **`CustomerInfo`** ergonomic wrapper; **`EntitleHubError`** with `.status` / `.code`.
- Zero dependencies; ESM + CJS + bundled type declarations.
