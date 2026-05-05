import test from "node:test";
import assert from "node:assert/strict";

import { parseOsmXml } from "../src/js/osm-xml.js";
import { osmDataToL0L } from "../src/js/overpass.js";

test("parseOsmXml parses real-world OSM API XML for a way/full response", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
 <node id="4334062486" visible="true" version="4" changeset="422272" timestamp="2025-07-08T01:15:27Z" user="TrickyFoxy" uid="16126" lat="59.9450798" lon="30.4877940">
  <tag k="railway" v="switch"/>
 </node>
 <node id="4334062488" visible="true" version="4" changeset="422272" timestamp="2025-07-08T01:15:27Z" user="TrickyFoxy" uid="16126" lat="59.9458096" lon="30.4878246">
  <tag k="railway" v="switch"/>
 </node>
 <node id="4334062579" visible="true" version="4" changeset="422272" timestamp="2025-07-08T01:15:27Z" user="TrickyFoxy" uid="16126" lat="59.9462504" lon="30.4879169">
  <tag k="railway" v="switch"/>
 </node>
 <way id="4306339865" visible="true" version="1" changeset="288872" timestamp="2023-11-24T12:05:51Z" user="TrickyFoxy" uid="16126">
  <nd ref="4334062579"/>
  <nd ref="4334062488"/>
  <nd ref="4334062486"/>
  <tag k="branch" v="ОКТ"/>
  <tag k="operator" v="ОАО &quot;РЖД&quot;"/>
  <tag k="railway" v="rail"/>
 </way>
</osm>`;

  const data = parseOsmXml(xml);

  assert.equal(data.length, 4);
  assert.deepEqual(data.at(-1), {
    type: "way",
    id: 4306339865,
    version: 1,
    changeset: 288872,
    timestamp: "2023-11-24T12:05:51Z",
    user: "TrickyFoxy",
    uid: 16126,
    tags: {
      branch: "ОКТ",
      operator: "ОАО \"РЖД\"",
      railway: "rail"
    },
    nodes: [4334062579, 4334062488, 4334062486]
  });

  assert.match(osmDataToL0L(data), /way 4306339865/);
  assert.match(osmDataToL0L(data), /nd 4334062579/);
  assert.match(osmDataToL0L(data), /operator = ОАО "РЖД"/);
});
