import test from "node:test";
import assert from "node:assert/strict";

import { loadSupportedFile } from "../src/js/api.js";
import { prepareImportedFileData, renumberCreatedObjects } from "../src/js/file-import.js";

test("loadSupportedFile reads OSM XML from file input", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" version="3" lat="55.75" lon="37.61">
    <tag k="name" v="Point"/>
  </node>
</osm>`;

  const file = {
    name: "sample.osm",
    async text() {
      return xml;
    }
  };

  const loaded = await loadSupportedFile(file);

  assert.equal(loaded.sourceLabel, "sample.osm");
  assert.equal(loaded.raw, xml);
  assert.equal(loaded.editorData.length, 1);
  assert.equal(loaded.baseData.length, 1);
  assert.deepEqual(loaded.editorData[0], {
    type: "node",
    id: 1,
    version: 3,
    lat: 55.75,
    lon: 37.61,
    tags: {
      name: "Point"
    }
  });
});

test("renumberCreatedObjects renumbers created ids and updates references", () => {
  const result = renumberCreatedObjects(
    [
      {
        type: "node",
        id: 10,
        action: "create",
        lat: 55.75,
        lon: 37.61,
        tags: {}
      },
      {
        type: "way",
        id: 20,
        action: "create",
        tags: {},
        nodes: [10]
      }
    ],
    [
      {
        type: "node",
        id: -1,
        lat: 1,
        lon: 2,
        tags: {}
      }
    ]
  );

  assert.deepEqual(
    result.map((object) => [object.type, object.id]),
    [
      ["node", -2],
      ["way", -3]
    ]
  );
  assert.deepEqual(result[1].nodes, [-2]);
});

test("prepareImportedFileData preserves OSC semantics for create modify and delete", () => {
  const prepared = prepareImportedFileData([
    {
      type: "node",
      id: 100,
      action: "create",
      lat: 55.75,
      lon: 37.61,
      tags: { name: "New" }
    },
    {
      type: "way",
      id: 7,
      version: 4,
      action: "modify",
      tags: { highway: "service" },
      nodes: [100, 5]
    },
    {
      type: "node",
      id: 5,
      version: 8,
      action: "delete",
      lat: 55.76,
      lon: 37.62,
      tags: { name: "Old" }
    }
  ]);

  assert.deepEqual(
    prepared.editorData.map((object) => [object.type, object.id, object.action ?? null]),
    [
      ["node", -1, null],
      ["way", 7, null],
      ["node", 5, "delete"]
    ]
  );
  assert.deepEqual(prepared.editorData[1].nodes, [-1, 5]);
  assert.deepEqual(prepared.baseData, [
    {
      type: "way",
      id: 7,
      version: 4,
      tags: {},
      nodes: []
    },
    {
      type: "node",
      id: 5,
      version: 8,
      tags: {}
    }
  ]);
});
