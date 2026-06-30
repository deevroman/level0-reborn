import test from "node:test";
import assert from "node:assert/strict";

import {
  createOsc,
  createOsm,
  dataToLevel0L,
  mergeLoadedDataIntoEditorText,
  parseLevel0L,
  renumberDataForSandbox
} from "../src/js/level0l.js";
import { GENERATOR } from "../src/js/config.js";

test("parseLevel0L parses nodes, ways and relations without validation errors", () => {
  const source = [
    "node 10: 55.75, 37.61",
    "  name = Point",
    "",
    "way 20",
    "  highway = residential",
    "  nd 10",
    "  nd 11",
    "",
    "relation 30",
    "  type = route",
    "  wy 20 forward",
    "  nd 10 stop"
  ].join("\n");

  const { data, validation } = parseLevel0L(source);

  assert.deepEqual(validation, []);
  assert.deepEqual(data, [
    {
      type: "node",
      id: 10,
      tags: { name: "Point" },
      lat: 55.75,
      lon: 37.61
    },
    {
      type: "way",
      id: 20,
      tags: { highway: "residential" },
      nodes: [10, 11]
    },
    {
      type: "relation",
      id: 30,
      tags: { type: "route" },
      members: [
        { type: "way", id: 20, role: "forward" },
        { type: "node", id: 10, role: "stop" }
      ]
    }
  ]);
});

test("createOsc serializes delete actions into osmChange XML", () => {
  const { data } = parseLevel0L([
    "-node 10.7: 55.75, 37.61",
    "  name = Point"
  ].join("\n"));

  const osc = createOsc(data, 123);

  assert.match(osc, /<delete>/);
  assert.match(osc, /<node id='10' version='7' lat='55\.75' lon='37\.61' changeset='123'/);
  assert.match(osc, /<tag k='name' v='Point' \/>/);
});

test("createOsm serializes upload-ready XML", () => {
  const xml = createOsm([
    {
      action: "modify",
      timestamp: "TODAY",
      version: 2,
      type: "node",
      id: 123,
      lat: 51.12,
      lon: 21.34,
      tags: {
        building: "yes",
        key: "value"
      }
    }
  ]);

  assert.match(xml, /^<\?xml version='1\.0' encoding='UTF-8'\?>/);
  assert.match(xml, new RegExp(`<osm version='0\\.6' upload='true' generator='${GENERATOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'>`));
  assert.match(xml, /<node id='123' version='2' lat='51\.12' lon='21\.34' action='modify' timestamp='TODAY'>/);
  assert.match(xml, /<tag k='building' v='yes' \/>/);
  assert.match(xml, /<tag k='key' v='value' \/>/);
});

test("dataToLevel0L serializes parsed objects back to text", () => {
  assert.equal(
    dataToLevel0L([
      {
        type: "node",
        id: 10,
        version: 3,
        lat: 55.75,
        lon: 37.61,
        tags: { name: "Point" }
      },
      {
        type: "way",
        id: 20,
        action: "delete",
        tags: {},
        nodes: [10, 11]
      }
    ]),
    [
      "node 10.3: 55.75, 37.61",
      "  name = Point",
      "",
      "-way 20",
      "  nd 10",
      "  nd 11"
    ].join("\n")
  );
});

test("dataToLevel0L moves bare nodes to the end without blank lines between them", () => {
  assert.equal(
    dataToLevel0L([
      {
        type: "way",
        id: 20,
        tags: { highway: "service" },
        nodes: [10, 11]
      },
      {
        type: "node",
        id: 10,
        lat: 55.75,
        lon: 37.61,
        tags: {}
      },
      {
        type: "node",
        id: 12,
        lat: 55.77,
        lon: 37.63,
        tags: { name: "Tagged" }
      },
      {
        type: "node",
        id: 11,
        lat: 55.76,
        lon: 37.62,
        tags: {}
      }
    ]),
    [
      "way 20",
      "  highway = service",
      "  nd 10",
      "  nd 11",
      "",
      "node 12: 55.77, 37.63",
      "  name = Tagged",
      "",
      "node 10: 55.75, 37.61",
      "node 11: 55.76, 37.62"
    ].join("\n")
  );
});

test("mergeLoadedDataIntoEditorText replaces existing duplicates instead of appending them", () => {
  const existingText = [
    "way 20",
    "  highway = old",
    "  nd 10",
    "  nd 11",
    "",
    "node 10: 55.75, 37.61"
  ].join("\n");

  const merged = mergeLoadedDataIntoEditorText(existingText, [
    {
      type: "way",
      id: 20,
      tags: { highway: "new" },
      nodes: [10, 12]
    },
    {
      type: "node",
      id: 12,
      lat: 55.77,
      lon: 37.63,
      tags: {}
    }
  ]);

  assert.match(merged, /way 20\n {2}highway = new\n {2}nd 10\n {2}nd 12/);
  assert.doesNotMatch(merged, /highway = old/);
  assert.match(merged, /node 10: 55\.75, 37\.61/);
  assert.match(merged, /node 12: 55\.77, 37\.63/);
});

test("renumberDataForSandbox converts positive ids to negative and rewrites references", () => {
  assert.deepEqual(
    renumberDataForSandbox([
      {
        type: "node",
        id: 10,
        version: 4,
        action: "modify",
        lat: 55.75,
        lon: 37.61,
        tags: { name: "Point" }
      },
      {
        type: "way",
        id: 20,
        version: 7,
        nodes: [10, 11],
        tags: { highway: "service" }
      },
      {
        type: "relation",
        id: 30,
        version: 2,
        members: [
          { type: "way", id: 20, role: "" },
          { type: "node", id: 10, role: "stop" }
        ],
        tags: { type: "route" }
      },
      {
        type: "node",
        id: 11,
        lat: 55.76,
        lon: 37.62,
        tags: {}
      }
    ]),
    [
      {
        type: "node",
        id: -1,
        lat: 55.75,
        lon: 37.61,
        tags: { name: "Point" }
      },
      {
        type: "way",
        id: -2,
        nodes: [-1, -4],
        tags: { highway: "service" }
      },
      {
        type: "relation",
        id: -3,
        members: [
          { type: "way", id: -2, role: "" },
          { type: "node", id: -1, role: "stop" }
        ],
        tags: { type: "route" }
      },
      {
        type: "node",
        id: -4,
        lat: 55.76,
        lon: 37.62,
        tags: {}
      }
    ]
  );
});
