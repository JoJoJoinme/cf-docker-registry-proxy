import assert from "assert";

import {
  buildBasicAuthHeader,
  needsLibraryRewrite,
  normalizeList,
  rewriteLibraryPath,
  rewriteTokenRealm,
  routeByHostLabel,
  shouldServeLanding,
} from "../src/helpers.js";
import worker from "../src/index.js";

const tests = [
  function normalizeListHandlesMixedSeparators() {
    assert.deepStrictEqual(normalizeList(" a,\n'b'  \"c\"\t d "), ["a", "b", "c", "d"]);
  },
  function routeByHostLabelMapsSupportedRegistries() {
    assert.deepStrictEqual(routeByHostLabel("ghcr"), {
      upstream: "ghcr.io",
      fakeLanding: false,
    });
    assert.deepStrictEqual(routeByHostLabel("unknown"), {
      upstream: "registry-1.docker.io",
      fakeLanding: true,
    });
  },
  function landingHeuristicOnlyTriggersForBrowserLikeRoutes() {
    assert.strictEqual(
      shouldServeLanding({ pathname: "/", fakeLanding: true, hostLabel: "docker" }),
      true,
    );
    assert.strictEqual(
      shouldServeLanding({
        pathname: "/v2/library/busybox/manifests/latest",
        fakeLanding: false,
        hostLabel: "ghcr",
      }),
      false,
    );
  },
  function dockerHubOfficialImagesGetLibraryRewrite() {
    assert.strictEqual(
      needsLibraryRewrite("/v2/busybox/manifests/latest", "registry-1.docker.io"),
      true,
    );
    assert.strictEqual(
      rewriteLibraryPath("/v2/busybox/manifests/latest"),
      "/v2/library/busybox/manifests/latest",
    );
  },
  function realmRewritingPointsAuthFlowBackToWorkerOrigin() {
    const header =
      'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"';
    assert.strictEqual(
      rewriteTokenRealm(header, "https://docker.example.com"),
      'Bearer realm="https://docker.example.com/token",service="registry.docker.io"',
    );
  },
  function basicAuthHeaderEncodesDockerHubCredentials() {
    assert.strictEqual(buildBasicAuthHeader("user", "pat"), "Basic dXNlcjpwYXQ=");
    assert.strictEqual(buildBasicAuthHeader("", "pat"), null);
  },
  async function tokenRequestUsesDockerHubCredentials() {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response('{"token":"ok"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const request = new Request(
        "https://docker.example.com/token?service=registry.docker.io&scope=repository:library/busybox:pull",
        {
          headers: {
            "User-Agent": "Docker-Client/27.0",
            Accept: "application/json",
          },
        },
      );

      const response = await worker.fetch(request, {
        DOCKERHUB_USER: "user",
        DOCKERHUB_PAT: "pat",
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        calls[0].input,
        "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/busybox:pull",
      );
      assert.strictEqual(
        calls[0].init.headers.get("Authorization"),
        "Basic dXNlcjpwYXQ=",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
  async function manifestChallengeRewritesRealmToWorkerOrigin() {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response("{}", {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/busybox:pull"',
        },
      });
    };

    try {
      const request = new Request(
        "https://docker.example.com/v2/library/busybox/manifests/latest",
      );
      const response = await worker.fetch(request, {});
      assert.strictEqual(response.status, 401);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        calls[0].input.toString(),
        "https://registry-1.docker.io/v2/library/busybox/manifests/latest",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
  async function blobRedirectStripsRegistryHeadersBeforeSignedFetch() {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      calls.push({ input, init });
      if (calls.length === 1) {
        return new Response(null, {
          status: 307,
          headers: {
            location:
              "https://docker-images-prod.s3.amazonaws.com/blob?X-Amz-Signature=test",
          },
        });
      }

      return new Response("blob", {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
        },
      });
    };

    try {
      const request = new Request(
        "https://docker.example.com/v2/library/busybox/blobs/sha256:test",
        {
          headers: {
            Authorization: "Bearer registry-token",
            Host: "docker.example.com",
          },
        },
      );
      const response = await worker.fetch(request, {});
      assert.strictEqual(response.status, 200);
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(
        calls[1].input,
        "https://docker-images-prod.s3.amazonaws.com/blob?X-Amz-Signature=test",
      );
      assert.strictEqual(calls[1].init.headers.get("Authorization"), null);
      assert.strictEqual(calls[1].init.headers.get("Host"), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
];

let failures = 0;

for (const test of tests) {
  try {
    await test();
    process.stdout.write(`PASS ${test.name}\n`);
  } catch (error) {
    failures += 1;
    process.stderr.write(`FAIL ${test.name}\n${error.stack}\n`);
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  process.stdout.write(`\n${tests.length} tests passed.\n`);
}
