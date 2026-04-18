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
];

let failures = 0;

for (const test of tests) {
  try {
    test();
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
