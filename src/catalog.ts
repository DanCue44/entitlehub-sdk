import { EntitleHubError, request, type HttpOptions } from "./http.js";
import type { Store } from "./types.js";

// Typed client for the Catalog API (https://entitlehub.com/docs/catalog-api): entitlements,
// products, their mappings, and paywall offerings. Server-only: every call takes a secret key.
// Wire types mirror the API's JSON exactly (snake_case); inputs are camelCase like the rest of the SDK.

export type ProductType = "subscription" | "non_consumable" | "consumable";
export type Duration = "P1W" | "P1M" | "P3M" | "P6M" | "P1Y";

/** A product by id, by SKU (when it is on one store), or by explicit store + SKU. */
export type ProductRef = string | { id: string } | { store: Store; storeProductId: string };

export interface CatalogEntitlement {
  object: "entitlement";
  id: string;
  key: string;
  name: string;
  description: string;
  products: { id: string; store: Store; store_product_id: string }[];
  active_grants: number;
  created_at: string | null;
  archived_at: string | null;
}

export interface CatalogProduct {
  object: "product";
  id: string;
  store: Store;
  store_product_id: string;
  type: ProductType;
  duration: Duration | null;
  display_name: string;
  price_micros: number;
  currency: string;
  entitlements: string[];
  active_grants: number;
  archived_at: string | null;
}

export interface CatalogPackage {
  object: "package";
  id: string;
  identifier: string;
  display_name: string;
  position: number;
  store: Store;
  store_product_id: string;
  product: CatalogProduct | null;
}

export interface CatalogOffering {
  object: "offering";
  id: string;
  identifier: string;
  display_name: string;
  is_current: boolean;
  metadata: Record<string, unknown> | null;
  packages: CatalogPackage[];
  created_at: string;
  archived_at: string | null;
}

/** An offering as the SDK-facing /v1/offerings/all returns it: packages joined with their product. */
export interface ListedOffering {
  id: string;
  identifier: string;
  display_name: string;
  is_current: boolean;
  metadata: Record<string, unknown> | null;
  archived_at: string | null;
  packages: {
    id: string;
    identifier: string;
    display_name: string;
    position: number;
    store: Store;
    store_product_id: string;
    product: { display_name: string; type: string; price_micros: number; currency: string; entitlements: string[] } | null;
  }[];
}

export interface Deleted {
  object: string;
  id: string;
  deleted: true;
}

export interface CreateEntitlementInput {
  /** The exact string your app checks with isEntitled(). Can't change later. */
  key: string;
  name?: string;
  description?: string;
  /** Products that grant it, attached in the same call. */
  products?: ProductRef[];
}

export interface CreateProductInput {
  store: Store;
  storeProductId: string;
  type: ProductType;
  /** Required for subscriptions. */
  duration?: Duration;
  displayName?: string;
  /** Integer micros (4.99 → 4_990_000). */
  priceMicros?: number;
  currency?: string;
  /** Entitlement keys this product grants. */
  entitlements?: string[];
}

export interface PackageInput {
  identifier: string;
  product: ProductRef;
  position?: number;
  displayName?: string;
}

const enc = encodeURIComponent;

function productRefBody(r: ProductRef): unknown {
  if (typeof r === "string") return r;
  if ("id" in r) return { id: r.id };
  return { store: r.store, store_product_id: r.storeProductId };
}

/** Path segment + ?store= for a product ref. */
function productPath(r: ProductRef): { seg: string; qs: string } {
  if (typeof r === "string") return { seg: enc(r), qs: "" };
  if ("id" in r) return { seg: enc(r.id), qs: "" };
  return { seg: enc(r.storeProductId), qs: `?store=${enc(r.store)}` };
}

const archivedQs = (o?: { includeArchived?: boolean }) => (o?.includeArchived ? "include_archived=true" : "");

/**
 * Create, or return what already exists. Catalog creates answer 409 `*_exists` with the existing
 * row, so a setup script that runs on every deploy converges instead of failing.
 */
async function ensure<T>(create: () => Promise<T>, existsCode: string): Promise<T> {
  try {
    return await create();
  } catch (e) {
    if (e instanceof EntitleHubError && e.apiCode === existsCode && e.body?.existing) return e.body.existing as T;
    throw e;
  }
}

export class EntitlementsApi {
  constructor(private http: HttpOptions) {}

  async list(opts?: { includeArchived?: boolean }): Promise<CatalogEntitlement[]> {
    const qs = archivedQs(opts);
    return (await request<{ entitlements: CatalogEntitlement[] }>(this.http, "GET", `/entitlements${qs ? `?${qs}` : ""}`)).entitlements;
  }

  /** By id or key. */
  get(ref: string): Promise<CatalogEntitlement> {
    return request(this.http, "GET", `/entitlements/${enc(ref)}`);
  }

  create(input: CreateEntitlementInput): Promise<CatalogEntitlement> {
    return request(this.http, "POST", "/entitlements", {
      key: input.key,
      name: input.name,
      description: input.description,
      products: input.products?.map(productRefBody),
    });
  }

  /** Create, or return the entitlement that already has this key. */
  ensure(input: CreateEntitlementInput): Promise<CatalogEntitlement> {
    return ensure(() => this.create(input), "entitlement_exists");
  }

  /** `products`, when given, REPLACES the set of products that grant it. */
  update(ref: string, patch: { name?: string; description?: string; products?: ProductRef[] }): Promise<CatalogEntitlement> {
    return request(this.http, "PATCH", `/entitlements/${enc(ref)}`, {
      name: patch.name,
      description: patch.description,
      products: patch.products?.map(productRefBody),
    });
  }

  /** Refused (409 `entitlement_in_use`) once anyone has been granted it. Archive instead. */
  delete(ref: string): Promise<Deleted> {
    return request(this.http, "DELETE", `/entitlements/${enc(ref)}`);
  }

  async products(ref: string, opts?: { includeArchived?: boolean }): Promise<CatalogProduct[]> {
    const qs = archivedQs(opts);
    return (await request<{ products: CatalogProduct[] }>(this.http, "GET", `/entitlements/${enc(ref)}/products${qs ? `?${qs}` : ""}`)).products;
  }

  attachProducts(ref: string, products: ProductRef[]): Promise<CatalogEntitlement> {
    return request(this.http, "POST", `/entitlements/${enc(ref)}/attach_products`, { products: products.map(productRefBody) });
  }

  detachProducts(ref: string, products: ProductRef[]): Promise<CatalogEntitlement> {
    return request(this.http, "POST", `/entitlements/${enc(ref)}/detach_products`, { products: products.map(productRefBody) });
  }

  /** Hide it from listings. Never takes access away from anyone who holds it. */
  archive(ref: string): Promise<CatalogEntitlement> {
    return request(this.http, "POST", `/entitlements/${enc(ref)}/archive`);
  }

  unarchive(ref: string): Promise<CatalogEntitlement> {
    return request(this.http, "POST", `/entitlements/${enc(ref)}/unarchive`);
  }
}

export class ProductsApi {
  constructor(private http: HttpOptions) {}

  async list(opts?: { store?: Store; entitlement?: string; includeArchived?: boolean }): Promise<CatalogProduct[]> {
    const q = new URLSearchParams();
    if (opts?.store) q.set("store", opts.store);
    if (opts?.entitlement) q.set("entitlement", opts.entitlement);
    if (opts?.includeArchived) q.set("include_archived", "true");
    const qs = q.toString();
    return (await request<{ products: CatalogProduct[] }>(this.http, "GET", `/products${qs ? `?${qs}` : ""}`)).products;
  }

  get(ref: ProductRef): Promise<CatalogProduct> {
    const { seg, qs } = productPath(ref);
    return request(this.http, "GET", `/products/${seg}${qs}`);
  }

  create(input: CreateProductInput): Promise<CatalogProduct> {
    return request(this.http, "POST", "/products", {
      store: input.store,
      store_product_id: input.storeProductId,
      type: input.type,
      duration: input.duration,
      display_name: input.displayName,
      price_micros: input.priceMicros,
      currency: input.currency,
      entitlements: input.entitlements,
    });
  }

  /** Create, or return the product that already has this store + SKU. */
  ensure(input: CreateProductInput): Promise<CatalogProduct> {
    return ensure(() => this.create(input), "product_exists");
  }

  /** `entitlements`, when given, REPLACES what it grants (future purchases only). */
  update(
    ref: ProductRef,
    patch: { displayName?: string; priceMicros?: number; currency?: string; entitlements?: string[] },
  ): Promise<CatalogProduct> {
    const { seg, qs } = productPath(ref);
    return request(this.http, "PATCH", `/products/${seg}${qs}`, {
      display_name: patch.displayName,
      price_micros: patch.priceMicros,
      currency: patch.currency,
      entitlements: patch.entitlements,
    });
  }

  /** Refused (409 `product_in_use`) once anyone has bought it. Archive instead. */
  delete(ref: ProductRef): Promise<Deleted> {
    const { seg, qs } = productPath(ref);
    return request(this.http, "DELETE", `/products/${seg}${qs}`);
  }

  attachEntitlements(ref: ProductRef, entitlements: string[]): Promise<CatalogProduct> {
    const { seg, qs } = productPath(ref);
    return request(this.http, "POST", `/products/${seg}/attach_entitlements${qs}`, { entitlements });
  }

  detachEntitlements(ref: ProductRef, entitlements: string[]): Promise<CatalogProduct> {
    const { seg, qs } = productPath(ref);
    return request(this.http, "POST", `/products/${seg}/detach_entitlements${qs}`, { entitlements });
  }

  /** Retire a SKU: gone from listings and paywalls; existing subscribers keep access and renewals. */
  archive(ref: ProductRef): Promise<CatalogProduct> {
    const { seg, qs } = productPath(ref);
    return request(this.http, "POST", `/products/${seg}/archive${qs}`);
  }

  unarchive(ref: ProductRef): Promise<CatalogProduct> {
    const { seg, qs } = productPath(ref);
    return request(this.http, "POST", `/products/${seg}/unarchive${qs}`);
  }
}

export class OfferingsApi {
  constructor(private http: HttpOptions) {}

  /** Every offering. Archived ones only with includeArchived. */
  async list(opts?: { includeArchived?: boolean }): Promise<ListedOffering[]> {
    const qs = archivedQs(opts);
    return (await request<{ offerings: ListedOffering[] }>(this.http, "GET", `/offerings/all${qs ? `?${qs}` : ""}`)).offerings;
  }

  /** By id or identifier. */
  get(ref: string): Promise<CatalogOffering> {
    return request(this.http, "GET", `/offerings/${enc(ref)}`);
  }

  create(input: {
    identifier: string;
    displayName?: string;
    isCurrent?: boolean;
    metadata?: Record<string, unknown>;
    packages?: PackageInput[];
  }): Promise<CatalogOffering> {
    return request(this.http, "POST", "/offerings", {
      identifier: input.identifier,
      display_name: input.displayName,
      is_current: input.isCurrent,
      metadata: input.metadata,
      packages: input.packages?.map(packageBody),
    });
  }

  /** `isCurrent: true` makes it the offering /current serves. `metadata: null` clears it. */
  update(ref: string, patch: { displayName?: string; isCurrent?: true; metadata?: Record<string, unknown> | null }): Promise<CatalogOffering> {
    return request(this.http, "PATCH", `/offerings/${enc(ref)}`, {
      display_name: patch.displayName,
      is_current: patch.isCurrent,
      metadata: patch.metadata,
    });
  }

  delete(ref: string): Promise<Deleted> {
    return request(this.http, "DELETE", `/offerings/${enc(ref)}`);
  }

  archive(ref: string): Promise<CatalogOffering> {
    return request(this.http, "POST", `/offerings/${enc(ref)}/archive`);
  }

  unarchive(ref: string): Promise<CatalogOffering> {
    return request(this.http, "POST", `/offerings/${enc(ref)}/unarchive`);
  }

  async packages(ref: string): Promise<CatalogPackage[]> {
    return (await request<{ packages: CatalogPackage[] }>(this.http, "GET", `/offerings/${enc(ref)}/packages`)).packages;
  }

  addPackage(ref: string, input: PackageInput): Promise<CatalogPackage> {
    return request(this.http, "POST", `/offerings/${enc(ref)}/packages`, packageBody(input));
  }

  /** `pkg` is the package id, or its identifier when that is used on one store only. */
  updatePackage(ref: string, pkg: string, patch: { displayName?: string; position?: number; product?: ProductRef }): Promise<CatalogPackage> {
    return request(this.http, "PATCH", `/offerings/${enc(ref)}/packages/${enc(pkg)}`, {
      display_name: patch.displayName,
      position: patch.position,
      product: patch.product === undefined ? undefined : productRefBody(patch.product),
    });
  }

  deletePackage(ref: string, pkg: string): Promise<Deleted> {
    return request(this.http, "DELETE", `/offerings/${enc(ref)}/packages/${enc(pkg)}`);
  }
}

function packageBody(p: PackageInput) {
  return { identifier: p.identifier, product: productRefBody(p.product), position: p.position, display_name: p.displayName };
}
