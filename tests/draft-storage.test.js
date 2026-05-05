import test from "node:test";
import assert from "node:assert/strict";

import {
  clearCommentDraft,
  clearWorkspaceState,
  loadCommentDraft,
  loadWorkspaceState,
  saveCommentDraft,
  saveWorkspaceState
} from "../src/js/draft-storage.js";
import { getPresetServerConfig } from "../src/js/server-config.js";

test("comment drafts are stored per server", () => {
  const storage = new Map();
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    }
  };

  try {
    const osm = getPresetServerConfig("osm");
    const ogf = getPresetServerConfig("ogf");

    saveCommentDraft(osm, "OSM comment");
    saveCommentDraft(ogf, "OGF comment");

    assert.equal(loadCommentDraft(osm), "OSM comment");
    assert.equal(loadCommentDraft(ogf), "OGF comment");

    clearCommentDraft(osm);
    assert.equal(loadCommentDraft(osm), "");
    assert.equal(loadCommentDraft(ogf), "OGF comment");
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test("workspace state is stored and restored", () => {
  const storage = new Map();
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    }
  };

  try {
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
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});
