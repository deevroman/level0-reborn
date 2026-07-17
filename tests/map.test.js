import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMapAreaReference,
  computeVisibleGeometryBbox
} from "../src/js/map.js";

test("buildMapAreaReference uses the current zoom instead of hardcoded 17", () => {
  assert.equal(
    buildMapAreaReference("45.322200", "37.304300", 15),
    "map=15/45.322200/37.304300"
  );

  assert.equal(
    buildMapAreaReference("45.322200", "37.304300", 17),
    "map=17/45.322200/37.304300"
  );
});

test("computeVisibleGeometryBbox unions visible points and segments", () => {
  assert.deepEqual(
    computeVisibleGeometryBbox({
      points: [
        { coords: [55.75, 37.61], tagged: true },
        { coords: [55.7, 37.8], tagged: false }
      ],
      segments: [
        [
          [55.8, 37.65],
          [55.78, 37.59]
        ]
      ]
    }),
    {
      minLat: 55.7,
      minLon: 37.59,
      maxLat: 55.8,
      maxLon: 37.8
    }
  );
});
