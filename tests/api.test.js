import test from "node:test";
import assert from "node:assert/strict";

import { loadIncompleteRelationData, loadSupportedUrl } from "../src/js/api.js";
import { getPresetServerConfig } from "../src/js/server-config.js";

const DEV_SERVER = getPresetServerConfig("osm-dev");

function createXmlResponse(xml) {
  return {
    ok: true,
    async text() {
      return xml;
    }
  };
}

test("loadSupportedUrl keeps incomplete relations untouched during normal loading", async () => {
  const calls = [];
  const fetchStub = async (url) => {
    calls.push(url);

    if (url === "https://master.apis.dev.openstreetmap.org/api/0.6/relation/10") {
      return createXmlResponse(`
        <osm version="0.6">
          <relation id="10" version="1">
            <member type="node" ref="100" role="" />
            <tag k="type" v="multipolygon" />
          </relation>
        </osm>
      `);
    }

    if (url === "https://master.apis.dev.openstreetmap.org/api/0.6/relation/10/full") {
      return createXmlResponse(`
        <osm version="0.6">
          <node id="100" version="3" lat="55.75" lon="37.61" />
          <relation id="10" version="1">
            <member type="node" ref="100" role="" />
            <tag k="type" v="multipolygon" />
          </relation>
        </osm>
      `);
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await loadSupportedUrl("/api/0.6/relation/10", DEV_SERVER, fetchStub);

  assert.deepEqual(calls, ["https://master.apis.dev.openstreetmap.org/api/0.6/relation/10"]);
  assert.deepEqual(result.requests, calls);
  assert.equal(result.data.length, 1);
  assert.ok(result.data.some((object) => object.type === "relation" && object.id === 10));
});

test("loadIncompleteRelationData expands incomplete relations with relation/full", async () => {
  const calls = [];
  const fetchStub = async (url) => {
    calls.push(url);

    if (url === "https://master.apis.dev.openstreetmap.org/api/0.6/relation/10/full") {
      return createXmlResponse(`
        <osm version="0.6">
          <node id="100" version="3" lat="55.75" lon="37.61" />
          <relation id="10" version="1">
            <member type="node" ref="100" role="" />
            <tag k="type" v="multipolygon" />
          </relation>
        </osm>
      `);
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await loadIncompleteRelationData(
    [
      {
        type: "relation",
        id: 10,
        version: 1,
        tags: { type: "multipolygon" },
        members: [{ type: "node", id: 100, role: "" }]
      }
    ],
    DEV_SERVER,
    fetchStub
  );

  assert.deepEqual(calls, ["https://master.apis.dev.openstreetmap.org/api/0.6/relation/10/full"]);
  assert.deepEqual(result.requests, calls);
  assert.deepEqual(result.addedData, [
    {
      type: "node",
      id: 100,
      version: 3,
      tags: {},
      lat: 55.75,
      lon: 37.61
    }
  ]);
  assert.equal(result.data.length, 2);
});

test("loadIncompleteRelationData recursively expands nested incomplete relations", async () => {
  const calls = [];
  const fetchStub = async (url) => {
    calls.push(url);

    if (url === "https://master.apis.dev.openstreetmap.org/api/0.6/relation/10/full") {
      return createXmlResponse(`
        <osm version="0.6">
          <relation id="20" version="4">
            <member type="node" ref="300" role="stop" />
            <tag k="type" v="route" />
          </relation>
          <relation id="10" version="1">
            <member type="relation" ref="20" role="" />
            <tag k="type" v="superroute" />
          </relation>
        </osm>
      `);
    }

    if (url === "https://master.apis.dev.openstreetmap.org/api/0.6/relation/20/full") {
      return createXmlResponse(`
        <osm version="0.6">
          <node id="300" version="2" lat="55.75" lon="37.61" />
          <relation id="20" version="4">
            <member type="node" ref="300" role="stop" />
            <tag k="type" v="route" />
          </relation>
        </osm>
      `);
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await loadIncompleteRelationData(
    [
      {
        type: "relation",
        id: 10,
        version: 1,
        tags: { type: "superroute" },
        members: [{ type: "relation", id: 20, role: "" }]
      }
    ],
    DEV_SERVER,
    fetchStub
  );

  assert.deepEqual(calls, [
    "https://master.apis.dev.openstreetmap.org/api/0.6/relation/10/full",
    "https://master.apis.dev.openstreetmap.org/api/0.6/relation/20/full"
  ]);
  assert.deepEqual(result.requests, calls);
  assert.ok(result.addedData.some((object) => object.type === "relation" && object.id === 20));
  assert.ok(result.addedData.some((object) => object.type === "node" && object.id === 300));
  assert.ok(result.data.some((object) => object.type === "relation" && object.id === 10));
  assert.ok(result.data.some((object) => object.type === "relation" && object.id === 20));
  assert.ok(result.data.some((object) => object.type === "node" && object.id === 300));
});
