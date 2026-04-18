export const DEFAULT_UPSTREAM = "registry-1.docker.io";
export const AUTH_URL = "https://auth.docker.io";

export const HOST_ROUTING = {
  docker: "registry-1.docker.io",
  quay: "quay.io",
  gcr: "gcr.io",
  "k8s-gcr": "k8s.gcr.io",
  k8s: "registry.k8s.io",
  ghcr: "ghcr.io",
  cloudsmith: "docker.cloudsmith.io",
  nvcr: "nvcr.io",
};

export function normalizeList(value = "") {
  return value
    .replace(/[\t "'\r\n]+/g, ",")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseUserAgentBlocklist(env) {
  const value = env && typeof env.UA_BLOCKLIST === "string" ? env.UA_BLOCKLIST : "";
  return ["netcraft"].concat(normalizeList(value));
}

export function routeByHostLabel(label) {
  if (label in HOST_ROUTING) {
    return { upstream: HOST_ROUTING[label], fakeLanding: false };
  }
  return { upstream: DEFAULT_UPSTREAM, fakeLanding: true };
}

export function isUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function shouldServeLanding({ pathname, fakeLanding, hostLabel }) {
  const parts = pathname.split("/").filter(Boolean);
  const firstSegment = parts.length > 0 ? parts[0] : "";
  const conditions = [
    isUuid(firstSegment),
    pathname.includes("/_"),
    pathname.includes("/r"),
    pathname.includes("/v2/user"),
    pathname.includes("/v2/orgs"),
    pathname.includes("/v2/_catalog"),
    pathname.includes("/v2/categories"),
    pathname.includes("/v2/feature-flags"),
    pathname.includes("search"),
    pathname.includes("source"),
    pathname === "/",
    pathname === "/favicon.ico",
    pathname === "/auth/profile",
  ];

  return conditions.some(Boolean) && (fakeLanding || hostLabel === "docker");
}

export function needsLibraryRewrite(pathname, upstream) {
  return (
    upstream === DEFAULT_UPSTREAM &&
    /^\/v2\/[^/]+\/[^/]+\/[^/]+$/.test(pathname) &&
    !/^\/v2\/library\//.test(pathname)
  );
}

export function rewriteLibraryPath(pathname) {
  return `/v2/library/${pathname.split("/v2/")[1]}`;
}

export function rewriteTokenRealm(wwwAuthenticate, workerOrigin) {
  if (!wwwAuthenticate) return wwwAuthenticate;
  return wwwAuthenticate.split(AUTH_URL).join(workerOrigin);
}

export function buildBasicAuthHeader(username, pat) {
  if (!username || !pat) return null;
  const raw = `${username}:${pat}`;
  const encoded =
    typeof btoa === "function"
      ? btoa(raw)
      : Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

export function shouldStripHeadersForRedirect(urlLike) {
  try {
    const url = new URL(urlLike);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
