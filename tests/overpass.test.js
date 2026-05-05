import test from "node:test";
import assert from "node:assert/strict";

import { overpassToL0L } from "../src/js/overpass.js";

test("overpassToL0L converts relations, ways and nodes into Level0L blocks", () => {
  const input = [
    {
      type: "relation",
      id: 30,
      tags: { type: "route" },
      members: [
        { type: "way", ref: 20, role: "forward" },
        { type: "node", ref: 10, role: "stop" }
      ]
    },
    {
      type: "way",
      id: 20,
      tags: { highway: "residential" },
      nodes: [10, 11]
    },
    {
      type: "node",
      id: 10,
      lat: 55.75,
      lon: 37.61,
      tags: { name: "Point" }
    }
  ];

  assert.equal(
    overpassToL0L(input),
    [
      "relation 30",
      "  type = route",
      "  wy 20 forward",
      "  nd 10 stop",
      "",
      "way 20",
      "  highway = residential",
      "  nd 10",
      "  nd 11",
      "",
      "node 10: 55.75, 37.61",
      "  name = Point"
    ].join("\n")
  );
});

test("overpassToL0L keeps bare nodes together at the end", () => {
  assert.equal(
    overpassToL0L([
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
      "node 10: 55.75, 37.61",
      "node 11: 55.76, 37.62"
    ].join("\n")
  );
});
