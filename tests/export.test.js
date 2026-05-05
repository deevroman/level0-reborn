import test from "node:test";
import assert from "node:assert/strict";

import { prepareUploadData } from "../src/js/export.js";

test("prepareUploadData marks modified, deleted and created objects", () => {
  const baseData = [
    {
      type: "node",
      id: 1,
      version: 3,
      lat: 10,
      lon: 20,
      tags: { name: "Base" }
    },
    {
      type: "way",
      id: 2,
      version: 7,
      tags: { highway: "service" },
      nodes: [1, 3]
    }
  ];

  const userData = [
    {
      type: "node",
      id: 1,
      lat: 10,
      lon: 20,
      tags: { name: "Changed" }
    },
    {
      type: "way",
      id: 2,
      version: 7,
      action: "delete",
      tags: {},
      nodes: [1, 3]
    },
    {
      type: "node",
      id: 0,
      lat: 11,
      lon: 21,
      tags: { name: "New" }
    }
  ];

  const result = prepareUploadData(userData, baseData);

  assert.deepEqual(
    result.filter((object) => object.action).map((object) => [object.type, object.id, object.action]),
    [
      ["node", -1, "create"],
      ["node", 1, "modify"],
      ["way", 2, "delete"]
    ]
  );
});

test("prepareUploadData rejects updates without base data", () => {
  assert.throws(
    () => prepareUploadData([{ type: "node", id: 42, lat: 1, lon: 2, tags: {} }], []),
    /No base data for node 42/
  );
});

test("prepareUploadData orders created parent relations after child relations", () => {
  const result = prepareUploadData(
    [
      {
        type: "relation",
        id: -2,
        tags: { type: "superroute" },
        members: [{ type: "relation", id: -3, role: "" }]
      },
      {
        type: "relation",
        id: -3,
        tags: { type: "route" },
        members: [{ type: "node", id: -1, role: "stop" }]
      },
      {
        type: "node",
        id: -1,
        lat: 55.75,
        lon: 37.61,
        tags: { name: "Stop" }
      }
    ],
    []
  );

  assert.deepEqual(
    result.filter((object) => object.action).map((object) => [object.type, object.id, object.action]),
    [
      ["node", -1, "create"],
      ["relation", -3, "create"],
      ["relation", -2, "create"]
    ]
  );
});

test("prepareUploadData rewrites relation members to generated negative ids and skips reserved ids", () => {
  const result = prepareUploadData(
    [
      {
        type: "node",
        id: 0,
        lat: 55.75,
        lon: 37.61,
        tags: { name: "Stop" }
      },
      {
        type: "node",
        id: -10,
        lat: 55.76,
        lon: 37.62,
        tags: {}
      },
      {
        type: "way",
        id: 0,
        tags: { highway: "service" },
        nodes: [0, -10]
      },
      {
        type: "relation",
        id: 0,
        tags: { type: "route" },
        members: [
          { type: "node", id: 0, role: "stop" },
          { type: "way", id: 0, role: "" }
        ]
      },
      {
        type: "relation",
        id: -2,
        tags: { type: "superroute" },
        members: [{ type: "relation", id: 0, role: "" }]
      }
    ],
    []
  );

  const createdWay = result.find((object) => object.type === "way" && object.action === "create" && object.id === -3);
  const createdRelation = result.find((object) => object.type === "relation" && object.action === "create" && object.id === -4);
  const parentRelation = result.find((object) => object.type === "relation" && object.action === "create" && object.id === -2);

  assert.deepEqual(createdWay.nodes, [-1, -10]);
  assert.deepEqual(createdRelation.members, [
    { type: "node", id: -1, role: "stop" },
    { type: "way", id: -3, role: "" }
  ]);
  assert.deepEqual(parentRelation.members, [
    { type: "relation", id: -4, role: "" }
  ]);
});
