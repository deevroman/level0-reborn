import test from "node:test";
import assert from "node:assert/strict";

import {
  collectUploadObjectBboxes,
  buildUploadSplitPlan,
  splitUploadDataIntoGroups
} from "../src/js/upload-split.js";

test("collectUploadObjectBboxes unions before and after geometry", () => {
  const baseData = [
    { type: "node", id: 1, lat: 0, lon: 0, tags: {} },
    { type: "node", id: 2, lat: 0, lon: 1, tags: {} },
    {
      type: "way",
      id: 10,
      version: 1,
      tags: { highway: "service" },
      nodes: [1, 2]
    },
    {
      type: "relation",
      id: 20,
      version: 1,
      tags: { type: "route" },
      members: [{ type: "way", id: 10, role: "" }]
    }
  ];
  const uploadData = [
    { type: "node", id: 1, action: "modify", lat: 10, lon: 10, tags: {} },
    { type: "node", id: 2, action: "modify", lat: 10, lon: 11, tags: {} },
    {
      type: "way",
      id: 10,
      version: 1,
      action: "modify",
      tags: { highway: "service" },
      nodes: [1, 2]
    },
    {
      type: "relation",
      id: 20,
      version: 1,
      action: "modify",
      tags: { type: "route" },
      members: [{ type: "way", id: 10, role: "" }]
    }
  ];

  const bboxes = collectUploadObjectBboxes(uploadData, baseData);

  assert.deepEqual(bboxes.get("node1"), { minLat: 0, minLon: 0, maxLat: 10, maxLon: 10 });
  assert.deepEqual(bboxes.get("way10"), { minLat: 0, minLon: 0, maxLat: 10, maxLon: 11 });
  assert.deepEqual(bboxes.get("relation20"), { minLat: 0, minLon: 0, maxLat: 10, maxLon: 11 });
});

test("splitUploadDataIntoGroups splits large edits into at most four groups", () => {
  const uploadData = [
    {
      type: "changeset",
      id: 0,
      tags: { comment: "Split edit" }
    },
    { type: "node", id: -1, action: "create", lat: 0, lon: 0, tags: {} },
    { type: "node", id: -2, action: "create", lat: 50, lon: 0, tags: {} },
    { type: "node", id: -3, action: "create", lat: 0, lon: 50, tags: {} },
    { type: "node", id: -4, action: "create", lat: 50, lon: 50, tags: {} }
  ];

  const groups = splitUploadDataIntoGroups(uploadData, [], {
    maxGroups: 4,
    minSplitSizeKm: 10
  });

  assert.equal(groups.length, 4);
  assert.ok(groups.every((group) => group.some((object) => object.type === "changeset")));
  assert.deepEqual(
    groups.map((group) => group.filter((object) => object.type === "node").map((object) => object.id)),
    [[-1], [-2], [-3], [-4]]
  );
});

test("splitUploadDataIntoGroups keeps compact edits together", () => {
  const uploadData = [
    { type: "node", id: -1, action: "create", lat: 10, lon: 10, tags: {} },
    { type: "node", id: -2, action: "create", lat: 10.01, lon: 10.01, tags: {} }
  ];

  const groups = splitUploadDataIntoGroups(uploadData, [], {
    maxGroups: 4,
    minSplitSizeKm: 10
  });

  assert.equal(groups.length, 1);
});

test("buildUploadSplitPlan returns per-group bounding boxes", () => {
  const uploadData = [
    { type: "node", id: -1, action: "create", lat: 0, lon: 0, tags: {} },
    { type: "node", id: -2, action: "create", lat: 0, lon: 50, tags: {} },
    { type: "node", id: -3, action: "create", lat: 50, lon: 0, tags: {} },
    { type: "node", id: -4, action: "create", lat: 50, lon: 50, tags: {} }
  ];

  const plan = buildUploadSplitPlan(uploadData, [], {
    maxGroups: 4,
    minSplitSizeKm: 10
  });

  assert.equal(plan.groups.length, 4);
  assert.equal(plan.groupSummaries.length, 4);
  assert.deepEqual(plan.groupSummaries.map((group) => group.objectCount), [1, 1, 1, 1]);
  assert.ok(plan.groupSummaries.every((group) => group.bbox));
});
