import test from "node:test";
import assert from "node:assert/strict";

import { applyDiffResult, buildRefreshReference, remapPendingUploadData } from "../src/js/export.js";

test("applyDiffResult rewrites ids, versions and references after upload", () => {
  const synced = applyDiffResult(
    [
      {
        type: "node",
        id: -1,
        version: 1,
        action: "create",
        lat: 10,
        lon: 20,
        tags: { name: "New node" }
      },
      {
        type: "way",
        id: 20,
        version: 7,
        action: "modify",
        tags: { highway: "service" },
        nodes: [-1, 5]
      },
      {
        type: "relation",
        id: 30,
        version: 2,
        action: "delete",
        tags: {},
        members: []
      }
    ],
    [
      { type: "node", oldId: -1, newId: 101, newVersion: 1 },
      { type: "way", oldId: 20, newId: 20, newVersion: 8 }
    ]
  );

  assert.deepEqual(synced, [
    {
      type: "node",
      id: 101,
      version: 1,
      lat: 10,
      lon: 20,
      tags: { name: "New node" }
    },
    {
      type: "way",
      id: 20,
      version: 8,
      tags: { highway: "service" },
      nodes: [101, 5]
    }
  ]);
});

test("buildRefreshReference requests full data for ways and relations", () => {
  assert.equal(
    buildRefreshReference([
      { type: "node", id: 101 },
      { type: "way", id: 20 },
      { type: "relation", id: 30 },
      { type: "changeset", id: 0 }
    ]),
    "n101,w20!,r30!"
  );
});

test("remapPendingUploadData keeps pending actions while rewriting references", () => {
  const remapped = remapPendingUploadData(
    [
      {
        type: "way",
        id: 10,
        action: "modify",
        version: 1,
        tags: {},
        nodes: [-1, 5]
      },
      {
        type: "relation",
        id: -2,
        action: "create",
        tags: {},
        members: [{ type: "node", id: -1, role: "" }]
      }
    ],
    [
      { type: "node", oldId: -1, newId: 1001, newVersion: 1 },
      { type: "way", oldId: 10, newId: 10, newVersion: 2 }
    ]
  );

  assert.deepEqual(remapped, [
    {
      type: "way",
      id: 10,
      action: "modify",
      version: 2,
      tags: {},
      nodes: [1001, 5]
    },
    {
      type: "relation",
      id: -2,
      action: "create",
      tags: {},
      members: [{ type: "node", id: 1001, role: "" }]
    }
  ]);
});
