// Offline unit tests (mocked fetch). Run `npx tsc --outDir dist` (or `npm run build`) first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EntitleHub, EntitleHubServer, CustomerInfo, EntitleHubError } from "../dist/index.js";

function fakeFetch(handler) {
  return async (url, init) => {
    const { status = 200, body = {} } = handler(url, init) ?? {};
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
}

test("CustomerInfo wrapper exposes active map + helpers", () => {
  const info = new CustomerInfo({
    app_user_id: "u1",
    active_entitlements: [{ entitlement: "pro", status: "active", store: "app_store", product: "pro_monthly", expires_at: "2030-01-01T00:00:00Z", will_renew: true, since: null }],
  });
  assert.equal(info.isActive("pro"), true);
  assert.equal(info.isActive("team"), false);
  assert.deepEqual(info.activeEntitlementIds, ["pro"]);
  assert.deepEqual(info.expirationDate("pro"), new Date("2030-01-01T00:00:00Z"));
  assert.equal(info.expirationDate("team"), undefined);
});

test("client caches getCustomerInfo and network-only bypasses cache", async () => {
  let calls = 0;
  const eh = new EntitleHub({
    apiKey: "pk_test_x", appUserId: "u1", baseUrl: "https://x/v1",
    fetchImpl: fakeFetch(() => { calls++; return { body: { app_user_id: "u1", active_entitlements: [] } }; }),
  });
  await eh.getCustomerInfo();
  await eh.getCustomerInfo();               // cached
  assert.equal(calls, 1, "second read served from cache");
  await eh.getCustomerInfo({ fetchPolicy: "network-only" });
  assert.equal(calls, 2, "network-only refetches");
});

test("client rejects a secret key", () => {
  assert.throws(() => new EntitleHub({ apiKey: "sk_live_x", appUserId: "u1" }), (e) => e instanceof EntitleHubError && e.code === "config");
});

test("server rejects a non-secret key", () => {
  assert.throws(() => new EntitleHubServer({ apiKey: "pk_live_x" }), (e) => e instanceof EntitleHubError && e.code === "config");
});

test("HTTP errors surface as EntitleHubError with status", async () => {
  const eh = new EntitleHub({
    apiKey: "pk_test_x", appUserId: "u1", baseUrl: "https://x/v1",
    fetchImpl: fakeFetch(() => ({ status: 401, body: { error: "Invalid or revoked API key." } })),
  });
  await assert.rejects(() => eh.getCustomerInfo({ fetchPolicy: "network-only" }), (e) => e instanceof EntitleHubError && e.status === 401 && e.code === "auth");
});

test("addCustomerInfoUpdateListener fires and unsubscribes", async () => {
  let seen = 0;
  const eh = new EntitleHub({
    apiKey: "pk_test_x", appUserId: "u1", baseUrl: "https://x/v1",
    fetchImpl: fakeFetch(() => ({ body: { app_user_id: "u1", active_entitlements: [] } })),
  });
  const unsub = eh.addCustomerInfoUpdateListener(() => seen++);
  await eh.getCustomerInfo({ fetchPolicy: "network-only" });
  unsub();
  await eh.getCustomerInfo({ fetchPolicy: "network-only" });
  assert.equal(seen, 1, "listener fired once, not after unsubscribe");
});
