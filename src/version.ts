// Kept in sync with package.json on release. Sent on every request as
// `X-EntitleHub-Client` so the dashboard can tell a customer their SDK is behind
// (they otherwise find out only when a fixed bug bites them).
export const SDK_VERSION = "0.3.0";
export const SDK_NAME = "js";
