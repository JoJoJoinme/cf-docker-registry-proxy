import {
  AUTH_URL,
  DEFAULT_UPSTREAM,
  buildBasicAuthHeader,
  needsLibraryRewrite,
  parseUserAgentBlocklist,
  rewriteLibraryPath,
  rewriteTokenRealm,
  routeByHostLabel,
  shouldServeLanding,
  shouldStripHeadersForRedirect,
} from "./helpers.js";

const PREFLIGHT_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS",
  "access-control-max-age": "1728000",
};

function html(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "access-control-allow-origin": "*",
    },
  });
}

function landingPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Docker Registry Proxy</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #0b4ea2, #1b9df0);
      font-family: ui-sans-serif, system-ui, sans-serif;
      color: white;
    }
    main {
      width: min(640px, calc(100vw - 32px));
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 20px;
      padding: 24px;
      backdrop-filter: blur(12px);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
    }
    input {
      width: calc(100% - 24px);
      padding: 12px;
      border-radius: 12px;
      border: 0;
      font-size: 16px;
    }
    p, code {
      opacity: 0.92;
    }
  </style>
</head>
<body>
  <main>
    <h1>Docker Registry Proxy</h1>
    <p>Use this hostname directly with Docker clients, or search Docker Hub packages from the browser.</p>
    <form action="/search" method="get">
      <input name="q" placeholder="Search Docker Hub" />
    </form>
    <p><code>docker pull docker.example.com/library/busybox:latest</code></p>
  </main>
</body>
</html>`;
}

function nginxLanding() {
  return `<!DOCTYPE html>
<html>
<head><title>Welcome to nginx!</title></head>
<body><h1>Welcome to nginx!</h1><p>Further configuration is required.</p></body>
</html>`;
}

function makeCorsResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      ...headers,
      "access-control-allow-origin": "*",
    },
  });
}

async function handleTokenRequest(request, env, url) {
  const headers = new Headers({
    Host: "auth.docker.io",
    "User-Agent": request.headers.get("User-Agent") || "cf-docker-registry-proxy",
    Accept: request.headers.get("Accept") || "application/json",
    "Accept-Language": request.headers.get("Accept-Language") || "en-US,en;q=0.9",
    "Accept-Encoding": request.headers.get("Accept-Encoding") || "gzip, deflate, br",
    Connection: "keep-alive",
    "Cache-Control": "max-age=0",
  });

  const basicAuth = buildBasicAuthHeader(env.DOCKERHUB_USER, env.DOCKERHUB_PAT);
  if (basicAuth) {
    headers.set("Authorization", basicAuth);
  }

  return fetch(`${AUTH_URL}${url.pathname}${url.search}`, {
    method: "GET",
    headers,
  });
}

async function proxySignedRedirect(request, target) {
  if (
    request.method === "OPTIONS" &&
    request.headers.has("access-control-request-headers")
  ) {
    return new Response(null, { headers: PREFLIGHT_HEADERS });
  }

  const headers = new Headers(request.headers);
  if (shouldStripHeadersForRedirect(target)) {
    headers.delete("authorization");
    headers.delete("Authorization");
    headers.delete("host");
    headers.delete("Host");
  }

  const upstreamResponse = await fetch(target, {
    method: request.method,
    headers,
    redirect: "follow",
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
  });

  const newHeaders = new Headers(upstreamResponse.headers);
  newHeaders.set("access-control-expose-headers", "*");
  newHeaders.set("access-control-allow-origin", "*");
  newHeaders.set("cache-control", "max-age=1500");
  newHeaders.delete("content-security-policy");
  newHeaders.delete("content-security-policy-report-only");
  newHeaders.delete("clear-site-data");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: newHeaders,
  });
}

async function handleLanding(env, url) {
  const mode = (env.LANDING_PAGE_MODE || "search").toLowerCase();
  if (mode === "redirect" && env.LANDING_PAGE_URL) {
    return Response.redirect(env.LANDING_PAGE_URL, 302);
  }
  if (mode === "nginx") {
    return html(nginxLanding());
  }
  if (url.pathname === "/") {
    return html(landingPage());
  }
  return fetch(`https://registry.hub.docker.com${url.pathname}${url.search}`, {
    headers: { Host: "registry.hub.docker.com" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const userAgent = (request.headers.get("User-Agent") || "").toLowerCase();
    const blockedAgents = parseUserAgentBlocklist(env);
    const workerOrigin = `${url.protocol}//${url.host}`;

    if (blockedAgents.some((item) => item && userAgent.includes(item.toLowerCase()))) {
      return html(nginxLanding());
    }

    const ns = url.searchParams.get("ns");
    const requestHost = url.searchParams.get("hubhost") || url.hostname;
    const hostLabel = requestHost.split(".")[0];
    const { upstream: routedUpstream, fakeLanding } = routeByHostLabel(hostLabel);
    let upstream = ns ? (ns === "docker.io" ? DEFAULT_UPSTREAM : ns) : routedUpstream;

    if (shouldServeLanding({ pathname: url.pathname, fakeLanding, hostLabel })) {
      return handleLanding(env, url);
    }

    if (url.pathname.includes("/token")) {
      return handleTokenRequest(request, env, url);
    }

    if (!/%2F/.test(url.search) && /%3A/.test(url.toString())) {
      url.search = url.search.replace(/%3A(?=.*?&)/, "%3Alibrary%2F");
    }

    if (needsLibraryRewrite(url.pathname, upstream)) {
      url.pathname = rewriteLibraryPath(url.pathname);
    }

    url.hostname = upstream;
    url.protocol = "https:";

    const headers = new Headers({
      Host: upstream,
      "User-Agent": request.headers.get("User-Agent") || "",
      Accept: request.headers.get("Accept") || "*/*",
      "Accept-Language": request.headers.get("Accept-Language") || "",
      "Accept-Encoding": request.headers.get("Accept-Encoding") || "gzip, deflate, br",
      Connection: "keep-alive",
      "Cache-Control": "max-age=0",
    });

    if (request.headers.has("Authorization")) {
      headers.set("Authorization", request.headers.get("Authorization"));
    }

    const upstreamResponse = await fetch(url, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
      cf: { cacheTtl: 3600 },
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    const wwwAuthenticate = responseHeaders.get("www-authenticate");
    if (wwwAuthenticate) {
      responseHeaders.set(
        "www-authenticate",
        rewriteTokenRealm(wwwAuthenticate, workerOrigin),
      );
    }

    const redirectLocation = responseHeaders.get("location");
    if (redirectLocation) {
      return proxySignedRedirect(request, redirectLocation);
    }

    return makeCorsResponse(upstreamResponse.body, upstreamResponse.status, responseHeaders);
  },
};
