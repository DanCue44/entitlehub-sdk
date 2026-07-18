import type { ActiveEntitlement, CustomerInfoResponse } from "./types.js";

/**
 * Ergonomic wrapper around a subscriber's active entitlements — the object your UI reads.
 *
 *   const info = await eh.getCustomerInfo();
 *   if (info.isActive("pro")) showProFeatures();
 *   const ent = info.active["pro"];         // full detail (expiry, store, willRenew)
 */
export class CustomerInfo {
  readonly appUserId: string;
  /** Active entitlements keyed by identifier. */
  readonly active: Readonly<Record<string, ActiveEntitlement>>;
  /** Raw list, in case you want to iterate. */
  readonly entitlements: readonly ActiveEntitlement[];

  constructor(raw: CustomerInfoResponse) {
    this.appUserId = raw.app_user_id;
    this.entitlements = raw.active_entitlements ?? [];
    const map: Record<string, ActiveEntitlement> = {};
    for (const e of this.entitlements) map[e.entitlement] = e;
    this.active = map;
  }

  /** True if the subscriber currently holds this entitlement. */
  isActive(entitlementId: string): boolean {
    return Boolean(this.active[entitlementId]);
  }

  /** All active entitlement identifiers. */
  get activeEntitlementIds(): string[] {
    return Object.keys(this.active);
  }

  /** Expiry for an entitlement (null = lifetime, undefined = not held). */
  expirationDate(entitlementId: string): Date | null | undefined {
    const e = this.active[entitlementId];
    if (!e) return undefined;
    return e.expires_at ? new Date(e.expires_at) : null;
  }
}
