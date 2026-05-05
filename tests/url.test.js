import test from "node:test";
import assert from "node:assert/strict";

import { getPresetServerConfig } from "../src/js/server-config.js";
import { parseMapViewReference, urlToApiRequests } from "../src/js/url.js";

const DEV_SERVER = getPresetServerConfig("osm-dev");
const OGF_SERVER = getPresetServerConfig("ogf");

test("urlToApiRequests rejects unsupported input", () => {
  assert.equal(urlToApiRequests("", DEV_SERVER), false);
  assert.equal(urlToApiRequests("abc", DEV_SERVER), false);
  assert.equal(urlToApiRequests(",", DEV_SERVER), false);
});

test("urlToApiRequests normalizes object and API URLs like original Level0", () => {
  assert.equal(
    urlToApiRequests("/api/0.6/node/123", DEV_SERVER),
    "https://master.apis.dev.openstreetmap.org/api/0.6/node/123"
  );

  assert.equal(
    urlToApiRequests("https://master.apis.dev.openstreetmap.org/way/4306339865", DEV_SERVER),
    "https://master.apis.dev.openstreetmap.org/api/0.6/way/4306339865/full"
  );

  assert.equal(
    urlToApiRequests("https://www.openstreetmap.org/changeset/123", DEV_SERVER),
    "https://master.apis.dev.openstreetmap.org/api/0.6/changeset/123/download"
  );
});

test("urlToApiRequests supports object lists, full-object markers and bbox URLs", () => {
  assert.deepEqual(urlToApiRequests("n12,w34,r56", DEV_SERVER), [
    "https://master.apis.dev.openstreetmap.org/api/0.6/node/12",
    "https://master.apis.dev.openstreetmap.org/api/0.6/way/34",
    "https://master.apis.dev.openstreetmap.org/api/0.6/relation/56"
  ]);

  assert.equal(
    urlToApiRequests("w34!", DEV_SERVER),
    "https://master.apis.dev.openstreetmap.org/api/0.6/way/34/full"
  );

  assert.deepEqual(urlToApiRequests("n12*", DEV_SERVER), [
    "https://master.apis.dev.openstreetmap.org/api/0.6/node/12/ways",
    "https://master.apis.dev.openstreetmap.org/api/0.6/node/12/relations"
  ]);

  assert.equal(
    urlToApiRequests("15/12.34/56.78", DEV_SERVER),
    "https://master.apis.dev.openstreetmap.org/api/0.6/map?bbox=56.77880,12.33880,56.78120,12.34120"
  );

  assert.equal(
    urlToApiRequests("17/12.34/56.78", DEV_SERVER),
    "https://master.apis.dev.openstreetmap.org/api/0.6/map?bbox=56.77970,12.33970,56.78030,12.34030"
  );

  assert.equal(
    urlToApiRequests("18/12.34/56.78", DEV_SERVER),
    "https://master.apis.dev.openstreetmap.org/api/0.6/map?bbox=56.77975,12.33975,56.78025,12.34025"
  );

  assert.equal(
    urlToApiRequests("map=15/45.3222/37.3043", DEV_SERVER),
    "https://master.apis.dev.openstreetmap.org/api/0.6/map?bbox=37.30310,45.32100,37.30550,45.32340"
  );
});

test("urlToApiRequests supports known overpass interpreter URLs", () => {
  assert.equal(
    urlToApiRequests("overpass-api.de/api/interpreter?data=a-long-query", DEV_SERVER),
    "http://overpass-api.de/api/interpreter?data=a-long-query"
  );

  assert.equal(
    urlToApiRequests("overpass.private.coffee/api/interpreter?data=a-long-query", DEV_SERVER),
    "https://overpass.private.coffee/api/interpreter?data=a-long-query"
  );
});

test("urlToApiRequests supports OpenGeofiction browse URLs with the OGF preset", () => {
  assert.equal(
    urlToApiRequests("https://opengeofiction.net/way/461819", OGF_SERVER),
    "https://opengeofiction.net/api/0.6/way/461819/full"
  );
});

test("parseMapViewReference keeps zoom lat and lon from map references", () => {
  assert.deepEqual(
    parseMapViewReference("map=15/45.3222/37.3043"),
    { zoom: 15, lat: 45.3222, lon: 37.3043 }
  );

  assert.deepEqual(
    parseMapViewReference("15/45.3222/37.3043"),
    { zoom: 15, lat: 45.3222, lon: 37.3043 }
  );
});
