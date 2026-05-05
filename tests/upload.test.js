import test from "node:test";
import assert from "node:assert/strict";

import { createChangesetXml, parseDiffResult, uploadChanges } from "../src/js/upload.js";

test("createChangesetXml includes comment and created_by", () => {
  const xml = createChangesetXml(
    [
      {
        type: "changeset",
        id: 0,
        tags: {
          source: "survey"
        }
      }
    ],
    "Fix crossing"
  );

  assert.match(xml, /k='comment' v='Fix crossing'/);
  assert.match(xml, /k='source' v='survey'/);
  assert.match(xml, /k='created_by' v='Level0 Reborn v0\.1\.0'/);
});

test("uploadChanges performs create, upload and close in order", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.endsWith("/changeset/create")) {
      return new Response("555", { status: 200 });
    }

    if (url.endsWith("/changeset/555/upload")) {
      return new Response(
        `<diffResult generator="OpenStreetMap Server" version="0.6">
          <node old_id="-1" new_id="1001" new_version="1"/>
          <way old_id="10" new_id="10" new_version="9"/>
        </diffResult>`,
        { status: 200 }
      );
    }

    return new Response("", { status: 200 });
  };

  const result = await uploadChanges(
    [
      {
        type: "node",
        id: 1,
        version: 3,
        action: "modify",
        lat: 10,
        lon: 20,
        tags: { name: "Changed" }
      }
    ],
    "Fix crossing",
    undefined,
    fetchImpl,
    "token-123"
  );

  assert.equal(result.changesetId, 555);
  assert.deepEqual(result.diffResult, [
    { type: "node", oldId: -1, newId: 1001, newVersion: 1 },
    { type: "way", oldId: 10, newId: 10, newVersion: 9 }
  ]);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[2].options.method, "PUT");
  assert.match(calls[1].options.body, /<osmChange version="0.6"/);
});

test("parseDiffResult extracts old ids, new ids and new versions", () => {
  assert.deepEqual(
    parseDiffResult(`<diffResult generator="OpenStreetMap Server" version="0.6">
      <node old_id="-1" new_id="101" new_version="1"/>
      <way old_id="200" new_id="200" new_version="8"/>
      <relation old_id="300"/>
    </diffResult>`),
    [
      { type: "node", oldId: -1, newId: 101, newVersion: 1 },
      { type: "way", oldId: 200, newId: 200, newVersion: 8 },
      { type: "relation", oldId: 300, newId: null, newVersion: null }
    ]
  );
});
