import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCoordsToSelection,
  collectVisibleMapGeometry,
  collectWaySegments,
  findNodeCoords,
  locateSelectionGeometry,
  splitLines
} from "../src/js/map-text.js";

test("findNodeCoords finds coordinates by node id", () => {
  const lines = splitLines([
    "node 10: 55.75, 37.61",
    "node 11: 55.76, 37.62"
  ].join("\n"));

  assert.deepEqual(findNodeCoords(lines, 11), [55.76, 37.62]);
  assert.equal(findNodeCoords(lines, 99), false);
});

test("collectWaySegments builds polyline segments from referenced nodes", () => {
  const lines = splitLines([
    "way 20",
    "  nd 10",
    "  nd 11",
    "",
    "node 10: 55.75, 37.61",
    "node 11: 55.76, 37.62"
  ].join("\n"));

  assert.deepEqual(collectWaySegments(lines, 0, true), [
    {
      coords: [[55.75, 37.61], [55.76, 37.62]],
      color: "#f30"
    }
  ]);
});

test("locateSelectionGeometry centers node and way selections", () => {
  const text = [
    "way 20",
    "  nd 10",
    "  nd 11",
    "",
    "node 10: 55.75, 37.61",
    "node 11: 55.76, 37.62"
  ].join("\n");

  const wayGeometry = locateSelectionGeometry(text, text.indexOf("nd 10"), undefined, true);
  assert.deepEqual(wayGeometry.center, [55.75, 37.61]);
  assert.equal(wayGeometry.segments.length, 1);

  const nodeSelectionStart = text.indexOf("node 11");
  const nodeGeometry = locateSelectionGeometry(text, nodeSelectionStart);
  assert.deepEqual(nodeGeometry.center, [55.76, 37.62]);
});

test("applyCoordsToSelection updates node header coordinates", () => {
  const text = [
    "node 10: 55.75, 37.61",
    "  name = Point"
  ].join("\n");

  assert.equal(
    applyCoordsToSelection(text, 0, "55.80, 37.70"),
    [
      "node 10: 55.80, 37.70",
      "  name = Point"
    ].join("\n")
  );
});

test("applyCoordsToSelection updates referenced node coordinates from a way row", () => {
  const text = [
    "way 20",
    "  nd 10",
    "  nd 11",
    "",
    "node 10: 55.75, 37.61",
    "node 11: 55.76, 37.62"
  ].join("\n");

  assert.equal(
    applyCoordsToSelection(text, text.indexOf("nd 11"), "55.90, 37.80"),
    [
      "way 20",
      "  nd 10",
      "  nd 11",
      "",
      "node 10: 55.75, 37.61",
      "node 11: 55.90, 37.80"
    ].join("\n")
  );
});

test("collectVisibleMapGeometry returns visible points and way segments", () => {
  const text = [
    "node 10: 55.75, 37.61",
    "  name = Point",
    "-node 12: 55.77, 37.63",
    "",
    "way 20",
    "  nd 10",
    "  nd 11",
    "",
    "-way 21",
    "  nd 10",
    "  nd 12",
    "",
    "node 11: 55.76, 37.62"
  ].join("\n");

  assert.deepEqual(collectVisibleMapGeometry(text), {
    points: [
      { coords: [55.75, 37.61], tagged: true },
      { coords: [55.76, 37.62], tagged: false }
    ],
    segments: [
      [[55.75, 37.61], [55.76, 37.62]]
    ]
  });
});
