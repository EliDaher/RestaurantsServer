export type VersionedOrderSnapshot = {
  version?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
};

export function currentOrderVersion(order: VersionedOrderSnapshot) {
  const explicitVersion = Number(order.version);
  if (Number.isFinite(explicitVersion) && explicitVersion > 0) return explicitVersion;

  return timestampVersion(order.updatedAt) || timestampVersion(order.createdAt) || 0;
}

export function nextOrderVersion(currentVersion: number, now = Date.now()) {
  return Math.max(now, currentVersion + 1);
}

export function orderVersionConflict(baseVersion: number | undefined, currentVersion: number) {
  if (baseVersion === undefined) return "missing_base_version";
  return baseVersion === currentVersion ? "" : "version_conflict";
}

function timestampVersion(value: unknown) {
  if (!value) return 0;
  if (typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : 0;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
