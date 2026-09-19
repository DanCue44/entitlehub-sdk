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

test("catalog: products.create sends snake_case, a store-qualified ref routes with ?store", async () => {
  const calls = [];
  const eh = new EntitleHubServer({
    apiKey: "sk_test_x", baseUrl: "https://x/v1",
    fetchImpl: fakeFetch((url, init) => { calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) }); return { status: 201, body: { object: "product" } }; }),
  });
  await eh.products.create({ store: "stripe", storeProductId: "price_1", type: "subscription", duration: "P1M", priceMicros: 9_990_000, entitlements: ["pro"] });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://x/v1/products");
  assert.deepEqual(calls[0].body, { store: "stripe", store_product_id: "price_1", type: "subscription", duration: "P1M", price_micros: 9_990_000, entitlements: ["pro"] });

  await eh.products.update({ store: "play", storeProductId: "pro.monthly" }, { entitlements: ["pro", "team"] });
  assert.equal(calls[1].method, "PATCH");
  assert.equal(calls[1].url, "https://x/v1/products/pro.monthly?store=play");

  await eh.products.attachEntitlements({ store: "play", storeProductId: "pro.monthly" }, ["team"]);
  assert.equal(calls[2].url, "https://x/v1/products/pro.monthly/attach_entitlements?store=play");

  await eh.entitlements.attachProducts("pro", ["prod_1", { store: "app_store", storeProductId: "com.x.pro" }]);
  assert.deepEqual(calls[3].body, { products: ["prod_1", { store: "app_store", store_product_id: "com.x.pro" }] });
});

test("catalog: ensure returns the existing row on a 409 *_exists, and rethrows anything else", async () => {
  const existing = { object: "entitlement", id: "ent_1", key: "pro" };
  let reply = { status: 409, body: { error: "exists", code: "entitlement_exists", existing } };
  const eh = new EntitleHubServer({ apiKey: "sk_test_x", baseUrl: "https://x/v1", fetchImpl: fakeFetch(() => reply) });
  assert.deepEqual(await eh.entitlements.ensure({ key: "pro" }), existing);

  reply = { status: 400, body: { error: "bad key", code: "invalid_request" } };
  await assert.rejects(() => eh.entitlements.ensure({ key: "bad key" }),
    (e) => e instanceof EntitleHubError && e.status === 400 && e.apiCode === "invalid_request" && e.code === "http");
});

test("catalog: API error codes and context surface on EntitleHubError", async () => {
  const eh = new EntitleHubServer({
    apiKey: "sk_test_x", baseUrl: "https://x/v1",
    fetchImpl: fakeFetch(() => ({ status: 409, body: { error: "ambiguous", code: "ambiguous_product", candidates: [{ id: "p1" }, { id: "p2" }] } })),
  });
  await assert.rejects(() => eh.products.get("pro_monthly"), (e) => {
    assert.equal(e.apiCode, "ambiguous_product");
    assert.equal(e.body.candidates.length, 2);
    return true;
  });
});
