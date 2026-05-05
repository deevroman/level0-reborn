import test from "node:test";
import assert from "node:assert/strict";

import { buildMapAreaReference } from "../src/js/map.js";

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
