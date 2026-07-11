import { getServerStorageKey } from "./server-config.js";

const DATABASE_NAME = "level0-reborn-drafts-v1";
const STORE_NAME = "kv";
const COMMENT_DRAFT_KEY_PREFIX = "changeset_comment_draft";
const COMMENT_HISTORY_KEY_PREFIX = "changeset_comment_history";
const SEARCH_REPLACE_STATE_KEY = "search_replace_state_v1";
const WORKSPACE_STATE_KEY = "workspace_state_v1";

function getCommentDraftKey(serverConfig) {
  return `${COMMENT_DRAFT_KEY_PREFIX}:${getServerStorageKey(serverConfig)}`;
}

function getCommentHistoryKey(serverConfig) {
  return `${COMMENT_HISTORY_KEY_PREFIX}:${getServerStorageKey(serverConfig)}`;
}

function createMemoryBackend() {
  const store = new Map();

  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value) {
      store.set(key, String(value));
    },
    async delete(key) {
      store.delete(key);
    },
    async entries() {
      return [...store.entries()];
    },
    async clear() {
      store.clear();
    }
  };
}

function openIndexedDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    });

    request.addEventListener("success", () => {
      resolve(request.result);
    });

    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Failed to open draft storage database."));
    });
  });
}

function createIndexedDbBackend() {
  let databasePromise = null;

  const getDatabase = async () => {
    if (!databasePromise) {
      databasePromise = openIndexedDb();
    }

    return databasePromise;
  };

  const run = async (mode, handler) => {
    const database = await getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = handler(store);

      request.addEventListener("success", () => {
        resolve(request.result ?? null);
      });

      request.addEventListener("error", () => {
        reject(request.error ?? new Error("Draft storage operation failed."));
      });
    });
  };

  return {
    async get(key) {
      return run("readonly", (store) => store.get(key));
    },
    async set(key, value) {
      await run("readwrite", (store) => store.put(String(value), key));
    },
    async delete(key) {
      await run("readwrite", (store) => store.delete(key));
    },
    async entries() {
      const database = await getDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAllKeys();
        const valuesRequest = store.getAll();

        let keys = null;
        let values = null;

        const maybeResolve = () => {
          if (!keys || !values) {
            return;
          }

          resolve(keys.map((key, index) => [key, values[index]]));
        };

        request.addEventListener("success", () => {
          keys = request.result;
          maybeResolve();
        });
        valuesRequest.addEventListener("success", () => {
          values = valuesRequest.result;
          maybeResolve();
        });

        const rejectOnError = () => {
          reject(request.error ?? valuesRequest.error ?? new Error("Draft storage read failed."));
        };

        request.addEventListener("error", rejectOnError);
        valuesRequest.addEventListener("error", rejectOnError);
      });
    },
    async clear() {
      const database = await getDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.addEventListener("success", () => resolve());
        request.addEventListener("error", () => {
          reject(request.error ?? new Error("Failed to clear draft storage."));
        });
      });
    }
  };
}

function createBackend() {
  if (typeof indexedDB !== "undefined") {
    return createIndexedDbBackend();
  }

  return createMemoryBackend();
}

let backend = createBackend();
let cache = new Map();
let readyPromise = null;

async function hydrateCache() {
  if (readyPromise) {
    return readyPromise;
  }

  readyPromise = (async () => {
    backend = createBackend();
    const entries = await backend.entries();
    cache = new Map(entries);
  })();

  return readyPromise;
}

function persistValue(key, value) {
  cache.set(key, String(value));
  void hydrateCache().then(() => backend.set(key, value)).catch(() => {
    // Keep the in-memory cache even if persistence fails.
  });
}

function removeValue(key) {
  cache.delete(key);
  void hydrateCache().then(() => backend.delete(key)).catch(() => {
    // Keep the in-memory cache even if persistence fails.
  });
}

function readJsonValue(key, fallback) {
  try {
    const raw = cache.get(key);
    if (typeof raw !== "string" || raw.length === 0) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return fallback;
  }
}

function writeJsonValue(key, value) {
  persistValue(key, JSON.stringify(value));
}

export function ensureDraftStorageReady() {
  return hydrateCache();
}

export function loadCommentDraft(serverConfig) {
  return cache.get(getCommentDraftKey(serverConfig)) ?? "";
}

export function saveCommentDraft(serverConfig, value) {
  persistValue(getCommentDraftKey(serverConfig), value);
}

export function clearCommentDraft(serverConfig) {
  removeValue(getCommentDraftKey(serverConfig));
}

export function loadCommentHistory(serverConfig) {
  const parsed = readJsonValue(getCommentHistoryKey(serverConfig), []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item) => typeof item === "string" && item.trim().length > 0);
}

export function saveCommentHistory(serverConfig, value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return;
  }

  const existing = loadCommentHistory(serverConfig).filter((entry) => entry !== trimmed);
  existing.unshift(trimmed);
  writeJsonValue(getCommentHistoryKey(serverConfig), existing.slice(0, 12));
}

export function loadSearchReplaceState() {
  const parsed = readJsonValue(SEARCH_REPLACE_STATE_KEY, {
    searchValue: "",
    replaceValue: "",
    regexEnabled: false
  });

  return {
    searchValue: typeof parsed.searchValue === "string" ? parsed.searchValue : "",
    replaceValue: typeof parsed.replaceValue === "string" ? parsed.replaceValue : "",
    regexEnabled: parsed.regexEnabled === true
  };
}

export function saveSearchReplaceState(searchReplaceState) {
  writeJsonValue(SEARCH_REPLACE_STATE_KEY, {
    searchValue: searchReplaceState.searchValue ?? "",
    replaceValue: searchReplaceState.replaceValue ?? "",
    regexEnabled: searchReplaceState.regexEnabled === true
  });
}

export function loadWorkspaceState() {
  const parsed = readJsonValue(WORKSPACE_STATE_KEY, null);
  if (!parsed) {
    return null;
  }

  return {
    urlValue: typeof parsed.urlValue === "string" ? parsed.urlValue : "",
    osmDataValue: typeof parsed.osmDataValue === "string" ? parsed.osmDataValue : "",
    level0lValue: typeof parsed.level0lValue === "string" ? parsed.level0lValue : "",
    baseData: Array.isArray(parsed.baseData) ? parsed.baseData : [],
    oscPreview: typeof parsed.oscPreview === "string" ? parsed.oscPreview : ""
  };
}

export function saveWorkspaceState(workspaceState) {
  writeJsonValue(WORKSPACE_STATE_KEY, {
    urlValue: workspaceState.urlValue ?? "",
    osmDataValue: workspaceState.osmDataValue ?? "",
    level0lValue: workspaceState.level0lValue ?? "",
    baseData: workspaceState.baseData ?? [],
    oscPreview: workspaceState.oscPreview ?? ""
  });
}

export function clearWorkspaceState() {
  removeValue(WORKSPACE_STATE_KEY);
}

export function resetDraftStorageForTests() {
  backend = createMemoryBackend();
  cache = new Map();
  readyPromise = Promise.resolve();
}
