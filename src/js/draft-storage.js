import { getServerStorageKey } from "./server-config.js";

const COMMENT_DRAFT_KEY_PREFIX = "changeset_comment_draft";
const WORKSPACE_STATE_KEY = "workspace_state_v1";

function getCommentDraftKey(serverConfig) {
  return `${COMMENT_DRAFT_KEY_PREFIX}:${getServerStorageKey(serverConfig)}`;
}

export function loadCommentDraft(serverConfig) {
  return localStorage.getItem(getCommentDraftKey(serverConfig)) ?? "";
}

export function saveCommentDraft(serverConfig, value) {
  localStorage.setItem(getCommentDraftKey(serverConfig), value);
}

export function clearCommentDraft(serverConfig) {
  localStorage.removeItem(getCommentDraftKey(serverConfig));
}

export function loadWorkspaceState() {
  try {
    const raw = localStorage.getItem(WORKSPACE_STATE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return {
      urlValue: typeof parsed.urlValue === "string" ? parsed.urlValue : "",
      osmDataValue: typeof parsed.osmDataValue === "string" ? parsed.osmDataValue : "",
      level0lValue: typeof parsed.level0lValue === "string" ? parsed.level0lValue : "",
      baseData: Array.isArray(parsed.baseData) ? parsed.baseData : [],
      oscPreview: typeof parsed.oscPreview === "string" ? parsed.oscPreview : ""
    };
  } catch {
    return null;
  }
}

export function saveWorkspaceState(workspaceState) {
  localStorage.setItem(WORKSPACE_STATE_KEY, JSON.stringify({
    urlValue: workspaceState.urlValue ?? "",
    osmDataValue: workspaceState.osmDataValue ?? "",
    level0lValue: workspaceState.level0lValue ?? "",
    baseData: workspaceState.baseData ?? [],
    oscPreview: workspaceState.oscPreview ?? ""
  }));
}

export function clearWorkspaceState() {
  localStorage.removeItem(WORKSPACE_STATE_KEY);
}
