import test from "node:test";
import assert from "node:assert/strict";

import {
  clearCommentDraft,
  clearWorkspaceState,
  loadCommentHistory,
  loadCommentDraft,
  loadSearchReplaceState,
  loadWorkspaceState,
  resetDraftStorageForTests,
  saveCommentDraft,
  saveCommentHistory,
  saveSearchReplaceState,
  saveWorkspaceState
} from "../src/js/draft-storage.js";
import { getPresetServerConfig } from "../src/js/server-config.js";

test("comment drafts are stored per server", () => {
  resetDraftStorageForTests();

  const osm = getPresetServerConfig("osm");
  const ogf = getPresetServerConfig("ogf");

  saveCommentDraft(osm, "OSM comment");
  saveCommentDraft(ogf, "OGF comment");

  assert.equal(loadCommentDraft(osm), "OSM comment");
  assert.equal(loadCommentDraft(ogf), "OGF comment");

  clearCommentDraft(osm);
  assert.equal(loadCommentDraft(osm), "");
  assert.equal(loadCommentDraft(ogf), "OGF comment");
});

test("workspace state is stored and restored", () => {
  resetDraftStorageForTests();

  saveWorkspaceState({
    urlValue: "map=15/45.3222/37.3043",
    osmDataValue: "{\"elements\":[]}",
    level0lValue: "node 1: 45.3222, 37.3043",
    baseData: [{ type: "node", id: 1, lat: 45.3222, lon: 37.3043, tags: {} }],
    oscPreview: "<osmChange />"
  });

  assert.deepEqual(loadWorkspaceState(), {
    urlValue: "map=15/45.3222/37.3043",
    osmDataValue: "{\"elements\":[]}",
    level0lValue: "node 1: 45.3222, 37.3043",
    baseData: [{ type: "node", id: 1, lat: 45.3222, lon: 37.3043, tags: {} }],
    oscPreview: "<osmChange />"
  });

  clearWorkspaceState();
  assert.equal(loadWorkspaceState(), null);
});

test("comment history is stored per server", () => {
  resetDraftStorageForTests();

  const osm = getPresetServerConfig("osm");
  const ogf = getPresetServerConfig("ogf");

  saveCommentHistory(osm, "First comment");
  saveCommentHistory(osm, "Second comment");
  saveCommentHistory(ogf, "OGF comment");
  saveCommentHistory(osm, "Second comment");

  assert.deepEqual(loadCommentHistory(osm), ["Second comment", "First comment"]);
  assert.deepEqual(loadCommentHistory(ogf), ["OGF comment"]);
});

test("search and replace fields are stored", () => {
  resetDraftStorageForTests();

  assert.deepEqual(loadSearchReplaceState(), {
    searchValue: "",
    replaceValue: "",
    regexEnabled: false
  });

  saveSearchReplaceState({
    searchValue: "old ref",
    replaceValue: "new ref",
    regexEnabled: true
  });

  assert.deepEqual(loadSearchReplaceState(), {
    searchValue: "old ref",
    replaceValue: "new ref",
    regexEnabled: true
  });
});
