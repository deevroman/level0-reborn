import test from "node:test";
import assert from "node:assert/strict";

import { fetchCurrentUserName, getOAuthRedirectUri } from "../src/js/auth.js";

test("getOAuthRedirectUri uses the current editor address without query or hash", () => {
  assert.equal(
    getOAuthRedirectUri({
      origin: "https://editor.example.test",
      pathname: "/level0/index.html",
      search: "?code=123",
      hash: "#x"
    }),
    "https://editor.example.test/level0/index.html"
  );

  assert.equal(
    getOAuthRedirectUri({
      origin: "https://editor.example.test",
      pathname: "/level0/",
      search: "",
      hash: ""
    }),
    "https://editor.example.test/level0"
  );
});

test("fetchCurrentUserName extracts display_name from OSM user details XML", async () => {
  const fetchImpl = async () => new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
    <osm version="0.6">
      <user id="1" display_name="Test User &amp; Co." />
    </osm>`,
    { status: 200 }
  );

  const userName = await fetchCurrentUserName("token-123", undefined, fetchImpl);

  assert.equal(userName, "Test User & Co.");
});
