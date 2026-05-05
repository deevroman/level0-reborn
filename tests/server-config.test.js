import test from "node:test";
import assert from "node:assert/strict";

import {
  getPresetServerConfig,
  normalizeServerConfig,
  resolveServerEndpoint
} from "../src/js/server-config.js";

test("getPresetServerConfig returns expected built-in endpoints", () => {
  const osm = getPresetServerConfig("osm");
  const ohm = getPresetServerConfig("ohm");
  const ogf = getPresetServerConfig("ogf");

  assert.equal(osm.apiBase, "https://api.openstreetmap.org/api/0.6/");
  assert.equal(ohm.siteUrl, "https://www.openhistoricalmap.org");
  assert.equal(ogf.apiBase, "https://opengeofiction.net/api/0.6/");
});

test("normalizeServerConfig keeps custom overrides normalized", () => {
  const config = normalizeServerConfig({
    presetId: "custom",
    name: "My Server",
    siteUrl: "https://example.test/",
    apiBase: "https://api.example.test/api/0.6",
    clientId: "abc",
    redirectUri: "http://127.0.0.1:9999",
    scope: "read write"
  });

  assert.equal(config.siteUrl, "https://example.test");
  assert.equal(config.apiBase, "https://api.example.test/api/0.6/");
  assert.equal(resolveServerEndpoint(config, config.authorizationEndpoint), "https://example.test/oauth2/authorize");
  assert.equal(resolveServerEndpoint(config, config.tokenEndpoint), "https://example.test/oauth2/token");
  assert.equal(resolveServerEndpoint(config, config.revokeEndpoint), "https://example.test/oauth2/revoke");
  assert.equal(config.redirectUri, undefined);
  assert.equal(config.scope, undefined);
});
