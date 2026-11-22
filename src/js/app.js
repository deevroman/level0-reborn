import { loadIncompleteRelationData, loadSupportedFile, loadSupportedUrl } from "./api.js";
import { applyEditorReplacement, preservePageScroll } from "./editor-replacement.js";
import {
  clearStoredAuth,
  exchangeAuthCodeForToken,
  fetchCurrentUserName,
  getStoredAccessToken,
  getStoredUserName,
  login,
  logout,
  storeAccessToken,
  storeUserName
} from "./auth.js";
import {
  clearCommentDraft,
  clearWorkspaceState,
  ensureDraftStorageReady,
  loadCommentHistory,
  loadCommentDraft,
  loadSearchReplaceState,
  loadWorkspaceState,
  saveCommentDraft,
  saveCommentHistory,
  saveSearchReplaceState,
  saveWorkspaceState
} from "./draft-storage.js";
import {
  applyDiffResult,
  indexBaseData,
  remapPendingUploadData,
  prepareUploadData
} from "./export.js";
import {
  createOsc,
  createOsm,
  dataToLevel0L,
  mergeLoadedDataIntoEditorText,
  parseLevel0L,
  renumberDataForSandbox
} from "./level0l.js";
import { initMapEditor } from "./map.js";
import { osmDataToL0L } from "./overpass.js";
import {
  BUILTIN_SERVER_PRESETS,
  loadServerConfig,
  normalizeServerConfig,
  saveServerConfig
} from "./server-config.js";
import { buildUploadSplitPlan } from "./upload-split.js";
import { uploadChanges } from "./upload.js";
import { parseMapCenterParameter, parseMapViewReference, removeQueryParameter } from "./url.js";
import {
  countLineRegexOccurrences,
  countLiteralOccurrences,
  findLineRegexMatch,
  findLiteralMatch,
  findSearchHighlights,
  replaceAllLineRegex,
  replaceAllLiteral,
  replaceSearchMatch,
  updateAutomaticRegexMode
} from "./search-replace.js";

const THEME_STORAGE_KEY = "theme_preference_v1";

const state = {
  baseData: [],
  oscPreview: "",
  mapController: null,
  serverConfig: normalizeServerConfig(BUILTIN_SERVER_PRESETS["osm"])
};

function loadThemePreference() {
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return ["light", "dark", "sepia"].includes(storedTheme) ? storedTheme : "auto";
  } catch {
    return "auto";
  }
}

function applyThemePreference(theme) {
  if (["light", "dark", "sepia"].includes(theme)) {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function saveThemePreference(theme) {
  try {
    if (["light", "dark", "sepia"].includes(theme)) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } else {
      localStorage.removeItem(THEME_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors and keep the current in-memory theme choice.
  }
}

function setLoginState(loginButton, userName = "") {
  const isLoggedIn = userName.length > 0;
  const mobile = window.matchMedia("(max-width: 550px)").matches;
  loginButton.textContent = isLoggedIn ? userName : "Log in";
  loginButton.disabled = isLoggedIn && !mobile;
  loginButton.dataset.loggedIn = String(isLoggedIn);
  loginButton.parentElement.classList.remove("is-logout-open");
  if (isLoggedIn && mobile) {
    loginButton.setAttribute("aria-expanded", "false");
    loginButton.setAttribute("aria-controls", "logout");
  } else {
    loginButton.removeAttribute("aria-expanded");
    loginButton.removeAttribute("aria-controls");
  }
  loginButton.dataset.authReady = "true";
}

function setLoginButtonPending(loginButton, message) {
  loginButton.textContent = message;
  loginButton.disabled = true;
  loginButton.dataset.loggedIn = "false";
  loginButton.parentElement.classList.remove("is-logout-open");
  loginButton.removeAttribute("aria-expanded");
  loginButton.removeAttribute("aria-controls");
  loginButton.dataset.authReady = "true";
}

function parseOsmInput(value) {
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : parsed.elements;
}

function convertSourceToLevel0L(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (trimmed.startsWith("<")) {
    throw new Error("XML source conversion from the textarea is not supported yet.");
  }

  return osmDataToL0L(parseOsmInput(value));
}

function renderServerInfo() {
  document.title = "Level0 OpenStreetMap Editor";
}

function bindProjectInfo(projectInfoOpenButton, projectInfoDialog, projectInfoCloseButton) {
  if (!projectInfoOpenButton || !projectInfoDialog || !projectInfoCloseButton) {
    return;
  }

  projectInfoOpenButton.addEventListener("click", () => {
    if (typeof projectInfoDialog.showModal === "function") {
      projectInfoDialog.showModal();
      return;
    }

    projectInfoDialog.setAttribute("open", "");
  });

  projectInfoCloseButton.addEventListener("click", () => {
    if (typeof projectInfoDialog.close === "function") {
      projectInfoDialog.close();
      return;
    }

    projectInfoDialog.removeAttribute("open");
  });

  projectInfoDialog.addEventListener("click", (event) => {
    if (event.target === projectInfoDialog) {
      projectInfoDialog.close?.();
      projectInfoDialog.removeAttribute("open");
    }
  });
}

function bindDraggableDialog(dialog, dragHandle) {
  if (!dialog || !dragHandle) {
    return;
  }

  let activePointerId = null;
  let pointerOffsetX = 0;
  let pointerOffsetY = 0;

  const stopDragging = (event) => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    activePointerId = null;
    dialog.classList.remove("is-dragging");
  };

  dragHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button, a, input, select, textarea")) {
      return;
    }

    const dialogBounds = dialog.getBoundingClientRect();
    activePointerId = event.pointerId;
    pointerOffsetX = event.clientX - dialogBounds.left;
    pointerOffsetY = event.clientY - dialogBounds.top;
    dialog.style.position = "fixed";
    dialog.style.right = "auto";
    dialog.style.bottom = "auto";
    dialog.style.left = `${dialogBounds.left}px`;
    dialog.style.top = `${dialogBounds.top}px`;
    dialog.style.transform = "none";
    dialog.classList.add("is-dragging");
    dragHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  dragHandle.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    const dialogBounds = dialog.getBoundingClientRect();
    const maximumLeft = Math.max(0, window.innerWidth - dialogBounds.width);
    const maximumTop = Math.max(0, window.innerHeight - dialogBounds.height);
    const left = Math.min(Math.max(0, event.clientX - pointerOffsetX), maximumLeft);
    const top = Math.min(Math.max(0, event.clientY - pointerOffsetY), maximumTop);

    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
  });

  dragHandle.addEventListener("pointerup", stopDragging);
  dragHandle.addEventListener("pointercancel", stopDragging);
  dragHandle.addEventListener("lostpointercapture", stopDragging);
}

function setStatus(statusElement, message, type = "info") {
  statusElement.dataset.type = type;
  statusElement.replaceChildren(document.createTextNode(message));
}

function clearStatus(statusElement) {
  setStatus(statusElement, "", "info");
}

function setEditorLocked(level0lField, locked) {
  level0lField.disabled = locked;
}

function removeUrlParameterFromAddress(parameterName) {
  const nextUrl = removeQueryParameter(window.location, parameterName);
  window.history.replaceState(null, document.title, nextUrl);
}

function setStatusWithLink(statusElement, message, linkLabel, linkUrl, type = "success") {
  const link = document.createElement("a");
  link.href = linkUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = linkLabel;

  statusElement.dataset.type = type;
  statusElement.replaceChildren(
    document.createTextNode(message),
    link,
    document.createTextNode(".")
  );
}

function setStatusWithLinks(statusElement, message, links, type = "success") {
  const nodes = [document.createTextNode(message)];

  links.forEach((linkInfo, index) => {
    const link = document.createElement("a");
    link.href = linkInfo.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = linkInfo.label;
    nodes.push(link);

    if (index < links.length - 1) {
      nodes.push(document.createTextNode(", "));
    }
  });

  if (links.length === 1) {
    nodes.push(document.createTextNode("."));
  }

  if (links.length > 1) {
    const externalLinkSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" ' +
      'stroke-linecap="round" stroke-linejoin="round" ' +
      'class="lucide lucide-external-link-icon lucide-external-link" width="16" height="16">' +
      '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path>' +
      '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>' +
      "</svg>";
    const allA = document.createElement("a")
    allA.style.cursor = "pointer"
    allA.style.position = "relative"
    allA.style.top = "2px"
    allA.innerHTML = externalLinkSvg
    allA.onclick = e => {
      e.preventDefault()
      links.forEach(link => {
        window.open(link.url, "_blank")
      })
    }
    nodes.push(document.createTextNode("\xA0"));
    nodes.push(allA);
  }

  statusElement.dataset.type = type;
  statusElement.replaceChildren(...nodes);
}

function renderValidation(validationElement, validation) {
  state.validation = validation;
  validationElement.replaceChildren();

  for (const [isError, line, message] of validation) {
    const item = document.createElement("p");
    item.className = "validation-item";
    item.dataset.severity = isError ? "error" : "warning";
    item.textContent = `Line ${line + 1}: ${message}`;
    validationElement.append(item);
  }
  state.refreshEditorHighlights?.();
}

function renderOscPreview(sectionElement, previewElement, oscText) {
  sectionElement.hidden = oscText.length === 0 || document.querySelector("#diff-panel").hidden;
  previewElement.textContent = oscText;
}

function mergeBaseData(existingData, incomingData) {
  const merged = indexBaseData(existingData);

  for (const object of incomingData) {
    merged.set(`${object.type}${object.id}`, object);
  }

  return [...merged.values()];
}

function setEditorFromBase(level0lField) {
  level0lField.value = state.baseData.length > 0 ? osmDataToL0L(state.baseData) : "";
  state.mapController?.refreshFromText();
}

function parseEditor(level0lField) {
  return parseLevel0L(level0lField.value);
}

function buildUploadData(level0lField, validationElement, { rejectWarnings = false } = {}) {
  const { data, validation } = parseEditor(level0lField);
  renderValidation(validationElement, validation);

  if (validation.some(([isError]) => isError)) {
    throw new Error("There are severe validation errors, please fix them.");
  }

  if (rejectWarnings && validation.length > 0) {
    throw new Error("There are validation warnings, please fix them before splitting the upload.");
  }

  return prepareUploadData(data, state.baseData);
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderServerSettings(formElements, serverConfig) {
  formElements.presetSelect.value = serverConfig.presetId;
  formElements.nameInput.value = serverConfig.name;
  formElements.siteUrlInput.value = serverConfig.siteUrl;
  formElements.apiBaseInput.value = serverConfig.apiBase;
  formElements.clientIdInput.value = serverConfig.clientId;
  formElements.defaultBaseLayerUrlInput.value = serverConfig.defaultBaseLayer.tileUrl;
  formElements.tokenInput.value = getStoredAccessToken(serverConfig) ?? "";
  formElements.serverLabel.textContent = serverConfig.name;
  syncServerSettingsLocks(formElements, serverConfig);
}

function syncServerSettingsLocks(formElements, serverConfig) {
  const isBuiltinLockedPreset =
    serverConfig.presetId === "osm" ||
    serverConfig.presetId === "osm-dev" ||
    serverConfig.presetId === "ohm" ||
    serverConfig.presetId === "ogf";

  for (const input of formElements.lockableInputs) {
    input.disabled = isBuiltinLockedPreset;
  }
}

/**
 * Keeps a small synchronous copy for the first page render.
 * @param {"url"|"comment"} field Draft field to cache.
 * @param {string} value Current field value.
 */
function cacheInitialDraft(field, value) {
  try {
    localStorage.setItem(`initial_${field}_draft_v1`, value);
  } catch {
    // IndexedDB remains the primary draft storage.
  }
}

function syncCommentDraft(commentInput) {
  commentInput.value = loadCommentDraft(state.serverConfig);
  cacheInitialDraft("comment", commentInput.value);
}

function renderCommentHistory(commentHistoryElement) {
  if (!commentHistoryElement) {
    return;
  }

  const history = loadCommentHistory(state.serverConfig);
  commentHistoryElement.replaceChildren(
    ...history.map((comment) => {
      const option = document.createElement("option");
      option.value = comment;
      return option;
    })
  );
}

function persistWorkspaceState(urlInput, osmDataField, level0lField) {
  cacheInitialDraft("url", urlInput.value);
  saveWorkspaceState({
    urlValue: urlInput.value,
    osmDataValue: osmDataField.value,
    level0lValue: level0lField.value,
    baseData: state.baseData,
    oscPreview: state.oscPreview
  });
}

function updateSearchReplaceCount(countElement, level0lField, searchInput, regexCheckbox, currentMatch = null) {
  const regexEnabled = regexCheckbox?.checked === true;
  const errorElement = document.querySelector("#search-replace-error");

  try {
    const matches = findSearchHighlights(level0lField.value, searchInput.value, regexEnabled, true);
    const currentIndex = currentMatch === null
      ? 0
      : matches.findIndex((match) => match.index === currentMatch.index && match.length === currentMatch.length);
    const position = matches.length === 0 ? 0 : (currentIndex < 0 ? 1 : currentIndex + 1);
    countElement.textContent = `${position}/${matches.length}`;
    countElement.setAttribute("aria-label", `Match ${position} of ${matches.length}`);
    errorElement.textContent = "";
    return matches.length;
  } catch {
    countElement.textContent = "–/–";
    countElement.setAttribute("aria-label", "Invalid regular expression");
    errorElement.textContent = "Invalid regular expression.";
    return 0;
  }
}

function persistSearchReplaceState(searchInput, replaceInput, regexCheckbox) {
  saveSearchReplaceState({
    searchValue: searchInput.value,
    replaceValue: replaceInput.value,
    regexEnabled: regexCheckbox?.checked === true
  });
}

/**
 * Adjusts a search-and-replace field to fit all of its lines.
 *
 * @param {HTMLTextAreaElement} textarea
 * @returns {void}
 */
function autoResizeSearchReplaceTextarea(textarea) {
  textarea.style.height = "auto";
  const borderHeight = textarea.offsetHeight - textarea.clientHeight;
  textarea.style.height = `${textarea.scrollHeight + borderHeight}px`;
}

/**
 * @param {(startIndex: number) => ({ index: number, length: number } | null)} findMatch
 * @param {number} beforeIndex
 * @returns {{ index: number, length: number } | null}
 */
function findPreviousSearchMatch(findMatch, beforeIndex) {
  let previousMatch = null;
  let searchStart = 0;

  while (true) {
    const match = findMatch(searchStart);
    if (match === null || match.index >= beforeIndex) {
      return previousMatch;
    }

    previousMatch = match;
    searchStart = match.index + Math.max(match.length, 1);
  }
}

function openSearchReplacePanel(openButton, panelWrap, searchInput, level0lField, countElement, regexCheckbox) {
  const selectedText = level0lField.value.slice(level0lField.selectionStart ?? 0, level0lField.selectionEnd ?? 0);
  if (selectedText.length > 0) {
    searchInput.value = selectedText;
  }

  const panel = panelWrap.querySelector(".search-replace-panel");
  panelWrap.hidden = false;
  panelWrap.classList.add("open");
  const mobile = window.matchMedia("(max-width: 550px)").matches;
  if (mobile) {
    const visibleTop = window.visualViewport?.offsetTop ?? 0;
    const panelBounds = panel.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.left = `${Math.max(8, (window.innerWidth - panelBounds.width) / 2)}px`;
    panel.style.top = `${visibleTop + 8}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.transform = "none";
    panel.dataset.mobilePosition = "true";
  } else {
    const buttonBounds = openButton.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    const rightFits = buttonBounds.right + 8 + panelBounds.width <= window.innerWidth - 8;
    const left = rightFits ? buttonBounds.right + 8 : Math.max(8, window.innerWidth - panelBounds.width - 8);
    const desiredTop = rightFits ? buttonBounds.top : buttonBounds.bottom + 8;
    const top = Math.max(8, Math.min(desiredTop, window.innerHeight - panelBounds.height - 8));
    panel.style.position = "fixed";
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.transform = "none";
    delete panel.dataset.mobilePosition;
  }
  openButton?.setAttribute("aria-expanded", "true");
  updateSearchReplaceCount(countElement, level0lField, searchInput, regexCheckbox);
  searchInput.focus({ preventScroll: mobile });
  searchInput.select();
}

function closeSearchReplacePanel(openButton, panelWrap) {
  panelWrap.classList.remove("open");
  panelWrap.hidden = true;
  openButton?.setAttribute("aria-expanded", "false");
}

function restoreWorkspaceState(
  urlInput,
  osmDataField,
  level0lField,
  validationElement,
  oscSectionElement,
  oscPreviewElement
) {
  const workspaceState = loadWorkspaceState();
  urlInput.value = workspaceState?.urlValue ?? "";
  cacheInitialDraft("url", urlInput.value);
  if (!workspaceState) {
    return;
  }

  osmDataField.value = workspaceState.osmDataValue;
  level0lField.value = workspaceState.level0lValue;
  state.baseData = workspaceState.baseData;
  state.oscPreview = workspaceState.oscPreview;
  renderValidation(validationElement, []);
  renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
}

function bindWorkspacePersistence(urlInput, osmDataField, level0lField) {
  const save = () => {
    persistWorkspaceState(urlInput, osmDataField, level0lField);
  };

  urlInput.addEventListener("input", save);
  osmDataField.addEventListener("input", save);
  level0lField.addEventListener("input", save);
}

/**
 * @param {HTMLButtonElement} toggleButton Button that opens or closes the diff.
 * @param {HTMLElement} panel Overlay containing the comparison.
 * @param {HTMLElement} content Container for the CodeMirror view.
 * @param {HTMLTextAreaElement} editor Current editor text.
 * @param {HTMLInputElement} urlInput URL input.
 * @param {HTMLTextAreaElement} osmDataField Source data.
 * @param {HTMLElement} statusElement Status message container.
 * @param {HTMLElement} validationElement Validation message container.
 * @param {HTMLElement} oscSectionElement osmChange preview section.
 * @param {HTMLElement} oscPreviewElement osmChange text container.
 */
function bindDiffControl(toggleButton, panel, content, editor, urlInput, osmDataField, statusElement, validationElement, oscSectionElement, oscPreviewElement) {
  let view = null;
  let opening = false;
  const buttonLabel = toggleButton.querySelector("span");
  const coveredElements = [editor.parentElement, document.querySelector(".sidebar")];
  const labels = panel.querySelector(".diff-panel-labels");
  const close = () => {
    panel.hidden = true;
    oscSectionElement.hidden = true;
    for (const element of coveredElements) element.inert = false;
    toggleButton.setAttribute("aria-expanded", "false");
    buttonLabel.textContent = "Show changes";
    content.before(labels);
    view?.destroy();
    view = null;
  };

  toggleButton.addEventListener("click", async () => {
    if (!panel.hidden) {
      close();
      return;
    }
    if (opening) return;
    opening = true;
    toggleButton.disabled = true;
    try {
      const { createDiffView } = await import("../vendor/codemirror/diff-view.js");
      panel.hidden = false;
      view = createDiffView(content, state.baseData.length ? osmDataToL0L(state.baseData) : "", editor.value);
      view.dom.prepend(labels);
      for (const element of coveredElements) element.inert = true;
      toggleButton.setAttribute("aria-expanded", "true");
      buttonLabel.textContent = "Hide changes";
      try {
        const uploadData = buildUploadData(editor, validationElement);
        state.oscPreview = createOsc(uploadData, 1234);
        setStatus(statusElement, "Built osmChange preview.");
      } catch (error) {
        state.oscPreview = "";
        setStatus(statusElement, error.message, "error");
      }
      renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
      persistWorkspaceState(urlInput, osmDataField, editor);
    } catch (error) {
      close();
      setStatus(statusElement, `Could not open diff: ${error.message}`, "error");
    } finally {
      opening = false;
      toggleButton.disabled = false;
      toggleButton.focus({ preventScroll: true });
    }
  });
}

function renderThemeSettings(themeSelect) {
  if (!themeSelect) {
    return;
  }

  themeSelect.value = loadThemePreference();
}

function bindThemeSettings(themeSelect) {
  if (!themeSelect) {
    return;
  }

  themeSelect.addEventListener("change", () => {
    const theme = themeSelect.value;
    applyThemePreference(theme);
    saveThemePreference(theme);
  });
}

function hasEditorData(osmDataField, level0lField) {
  return (
    state.baseData.length > 0 ||
    state.oscPreview.length > 0 ||
    osmDataField.value.trim().length > 0 ||
    level0lField.value.trim().length > 0
  );
}

function clearEditorState(
  urlInput,
  fileInput,
  commentInput,
  osmDataField,
  level0lField,
  statusElement,
  validationElement,
  oscSectionElement,
  oscPreviewElement
) {
  state.baseData = [];
  state.oscPreview = "";
  urlInput.value = "";
  fileInput.value = "";
  commentInput.value = "";
  clearCommentDraft(state.serverConfig);
  cacheInitialDraft("url", "");
  cacheInitialDraft("comment", "");
  osmDataField.value = "";
  level0lField.value = "";
  state.mapController?.refreshFromText();
  renderValidation(validationElement, []);
  renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
  clearStatus(statusElement);
  clearWorkspaceState();
}

function clearLoadedEditorData(osmDataField, level0lField, validationElement, oscSectionElement, oscPreviewElement) {
  state.baseData = [];
  state.oscPreview = "";
  osmDataField.value = "";
  level0lField.value = "";
  state.mapController?.refreshFromText();
  renderValidation(validationElement, []);
  renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
}

function applySandboxConversion(level0lField, validationElement, oscSectionElement, oscPreviewElement) {
  const { data } = parseEditor(level0lField);
  const convertedData = renumberDataForSandbox(data);
  level0lField.value = dataToLevel0L(convertedData);
  state.baseData = convertedData.filter((object) => object.type !== "changeset");
  state.oscPreview = "";
  state.mapController?.refreshFromText();
  renderValidation(validationElement, []);
  renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
}

async function completeIncompleteRelationsForServerSwitch(level0lField, osmDataField, serverConfig) {
  const { data } = parseEditor(level0lField);
  const result = await loadIncompleteRelationData(data, serverConfig);

  if (result.addedData.length === 0) {
    return result;
  }

  level0lField.value = mergeLoadedDataIntoEditorText(level0lField.value, result.addedData);
  renderValidation(document.querySelector("#validation"), []);
  state.baseData = mergeBaseData(state.baseData, result.addedData);
  osmDataField.value = JSON.stringify(state.baseData, null, 2);
  state.mapController?.refreshFromText();
  return result;
}

function readServerSettings(formElements, presetOverride = formElements.presetSelect.value) {
  return normalizeServerConfig({
    presetId: presetOverride,
    name: formElements.nameInput.value,
    siteUrl: formElements.siteUrlInput.value,
    apiBase: formElements.apiBaseInput.value,
    clientId: formElements.clientIdInput.value,
    defaultBaseLayer: {
      tileUrl: formElements.defaultBaseLayerUrlInput.value
    }
  });
}

async function syncLoginStateForCurrentServer(loginButton) {
  const accessToken = getStoredAccessToken(state.serverConfig);
  if (!accessToken) {
    setLoginState(loginButton);
    return;
  }

  let userName = getStoredUserName(state.serverConfig) ?? "";
  if (userName.length === 0) {
    userName = await fetchCurrentUserName(accessToken, state.serverConfig);
    storeUserName(userName, state.serverConfig);
  }

  setLoginState(loginButton, userName);
}

async function restoreSession(loginButton) {
  const urlParams = new URLSearchParams(window.location.search);
  const authCode = urlParams.get("code");
  const overpassUrl = urlParams.get("url");

  if (authCode) {
    setLoginButtonPending(loginButton, "Authorizing...");
    const accessToken = await exchangeAuthCodeForToken(authCode, state.serverConfig);
    storeAccessToken(accessToken, state.serverConfig);
    const userName = await fetchCurrentUserName(accessToken, state.serverConfig);
    storeUserName(userName, state.serverConfig);
    window.history.replaceState(null, document.title, window.location.pathname);
    setLoginState(loginButton, userName);
    return { overpassUrl };
  }

  await syncLoginStateForCurrentServer(loginButton);
  return { overpassUrl };
}

function bindAuthControls(loginButton, logoutButton) {
  const mobileView = window.matchMedia("(max-width: 550px)");
  const authControls = loginButton.parentElement;
  const closeLogoutMenu = () => {
    authControls.classList.remove("is-logout-open");
    if (loginButton.hasAttribute("aria-expanded")) {
      loginButton.setAttribute("aria-expanded", "false");
    }
  };

  mobileView.addEventListener("change", () => {
    if (loginButton.dataset.loggedIn === "true") {
      setLoginState(loginButton, loginButton.textContent);
    }
  });
  loginButton.addEventListener("click", () => {
    if (loginButton.dataset.loggedIn === "true") {
      if (mobileView.matches) {
        const open = authControls.classList.toggle("is-logout-open");
        loginButton.setAttribute("aria-expanded", String(open));
      }
      return;
    }
    setLoginButtonPending(loginButton, "Redirecting...");
    login(state.serverConfig);
  });

  logoutButton.addEventListener("click", async () => {
    closeLogoutMenu();
    await logout(state.serverConfig);
    setLoginState(loginButton);
  });
  document.addEventListener("click", (event) => {
    if (!authControls.contains(event.target)) {
      closeLogoutMenu();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && authControls.classList.contains("is-logout-open")) {
      closeLogoutMenu();
      loginButton.focus();
    }
  });
}

function bindServerSettings(
  formElements,
  loginButton,
  statusElement,
  commentHistoryElement,
  urlInput,
  fileInput,
  commentInput,
  osmDataField,
  level0lField,
  validationElement,
  oscSectionElement,
  oscPreviewElement
) {
  formElements.presetSelect.addEventListener("change", async () => {
    const previousConfig = state.serverConfig;
    const nextPresetId = formElements.presetSelect.value;
    const shouldClearForAlternateServer =
      (nextPresetId === "ohm" || nextPresetId === "ogf") &&
      previousConfig.presetId !== nextPresetId &&
      hasEditorData(osmDataField, level0lField);

    if (
      nextPresetId === "osm" &&
      previousConfig.presetId !== "osm" &&
      hasEditorData(osmDataField, level0lField)
    ) {
      const confirmed = window.confirm(
        "Switching to the production OpenStreetMap server will clear the current data. Continue?"
      );

      if (!confirmed) {
        renderServerSettings(formElements, previousConfig);
        syncCommentDraft(formElements.commentInput);
        renderCommentHistory(commentHistoryElement);
        setStatus(statusElement, "Switch to OpenStreetMap was cancelled.");
        return;
      }

      clearEditorState(
        urlInput,
        fileInput,
        commentInput,
        osmDataField,
        level0lField,
        statusElement,
        validationElement,
        oscSectionElement,
        oscPreviewElement
      );
    }

    if (shouldClearForAlternateServer) {
      const nextServerName = nextPresetId === "ohm" ? "OpenHistoricalMap" : "OpenGeofiction";
      const confirmed = window.confirm(
        `Switching to ${nextServerName} will clear the current data. Continue?`
      );

      if (!confirmed) {
        renderServerSettings(formElements, previousConfig);
        syncCommentDraft(formElements.commentInput);
        renderCommentHistory(commentHistoryElement);
        setStatus(statusElement, `Switch to ${nextServerName} was cancelled.`);
        return;
      }

      clearEditorState(
        urlInput,
        fileInput,
        commentInput,
        osmDataField,
        level0lField,
        statusElement,
        validationElement,
        oscSectionElement,
        oscPreviewElement
      );
    }

    const shouldOfferSandboxConversion =
      previousConfig.presetId === "osm" &&
      nextPresetId === "osm-dev" &&
      hasEditorData(osmDataField, level0lField);

    if (shouldOfferSandboxConversion) {
      const confirmed = window.confirm(
        "Convert current object IDs to negative so they can be uploaded to the Dev sandbox as new objects?"
      );

      if (!confirmed) {
        renderServerSettings(formElements, previousConfig);
        syncCommentDraft(formElements.commentInput);
        renderCommentHistory(commentHistoryElement);
        setStatus(statusElement, "Switch to OpenStreetMap Dev was cancelled.");
        return;
      }

      try {
        await completeIncompleteRelationsForServerSwitch(level0lField, osmDataField, previousConfig);
      } catch (error) {
        renderServerSettings(formElements, previousConfig);
        syncCommentDraft(formElements.commentInput);
        renderCommentHistory(commentHistoryElement);
        setStatus(statusElement, error.message, "error");
        return;
      }
    }

    if (formElements.presetSelect.value === "custom") {
      state.serverConfig = readServerSettings(formElements, "custom");
    } else {
      state.serverConfig = normalizeServerConfig(BUILTIN_SERVER_PRESETS[formElements.presetSelect.value]);
    }
    renderServerSettings(formElements, state.serverConfig);

    saveServerConfig(state.serverConfig);
    state.mapController?.setDefaultBaseLayer(state.serverConfig.defaultBaseLayer);
    syncCommentDraft(formElements.commentInput);
    renderCommentHistory(commentHistoryElement);
    await syncLoginStateForCurrentServer(loginButton);

    if (shouldOfferSandboxConversion) {
      applySandboxConversion(level0lField, validationElement, oscSectionElement, oscPreviewElement);
      persistWorkspaceState(urlInput, osmDataField, level0lField);
      setStatus(
        statusElement,
        `Switched server to ${state.serverConfig.name} and converted object IDs for sandbox upload.`,
        "success"
      );
      return;
    }

    setStatus(statusElement, `Switched server to ${state.serverConfig.name}.`);
  });

  for (const input of formElements.editableInputs) {
    input.addEventListener("change", async () => {
      formElements.presetSelect.value = "custom";
      const previousTileUrl = state.serverConfig.defaultBaseLayer.tileUrl;
      state.serverConfig = readServerSettings(formElements, "custom");
      saveServerConfig(state.serverConfig);
      renderServerSettings(formElements, state.serverConfig);
      if (state.serverConfig.defaultBaseLayer.tileUrl !== previousTileUrl) {
        state.mapController?.setDefaultBaseLayer(state.serverConfig.defaultBaseLayer);
      }
      syncCommentDraft(formElements.commentInput);
      renderCommentHistory(commentHistoryElement);
      await syncLoginStateForCurrentServer(loginButton);
      setStatus(statusElement, `Saved custom server settings for ${state.serverConfig.name}.`);
    });
  }

  formElements.backdrop?.addEventListener("click", () => {
    formElements.container.removeAttribute("open");
  });

  formElements.tokenInput.addEventListener("change", async () => {
    try {
      const accessToken = formElements.tokenInput.value.trim();

      if (accessToken.length === 0) {
        clearStoredAuth(state.serverConfig);
        setLoginState(loginButton);
        setStatus(statusElement, `Cleared OAuth token for ${state.serverConfig.name}.`);
        return;
      }

      clearStoredAuth(state.serverConfig);
      storeAccessToken(accessToken, state.serverConfig);
      await syncLoginStateForCurrentServer(loginButton);
      setStatus(statusElement, `Saved OAuth token for ${state.serverConfig.name}.`, "success");
    } catch (error) {
      clearStoredAuth(state.serverConfig);
      setLoginState(loginButton);
      setStatus(statusElement, error.message, "error");
    }
  });
}

function bindConvertControl(convertButton, urlInput, osmDataField, level0lField, statusElement, validationElement) {
  convertButton.addEventListener("click", () => {
    try {
      level0lField.value = convertSourceToLevel0L(osmDataField.value);
      state.mapController?.refreshFromText();
      renderValidation(validationElement, []);
      setStatus(statusElement, "Converted source data into editor text.");
      persistWorkspaceState(urlInput, osmDataField, level0lField);
    } catch (error) {
      setStatus(statusElement, error.message, "error");
    }
  });
}

async function readLoadSource(urlInput, fileInput, level0lField, mode) {
  const file = fileInput.files?.[0];
  if (file) {
    const existingData = mode === "add" ? parseLevel0L(level0lField.value).data : [];
    return loadSupportedFile(file, existingData);
  }

  if (urlInput.value.trim().length > 0) {
    return loadSupportedUrl(urlInput.value, state.serverConfig);
  }

  throw new Error(mode === "replace" ? "Replace with what?" : "Add what?");
}

async function loadIntoEditor(urlInput, fileInput, osmDataField, level0lField, statusElement, mode) {
  try {
    const mapView = fileInput.files?.[0] ? null : parseMapViewReference(urlInput.value);
    const loaded = await readLoadSource(urlInput, fileInput, level0lField, mode);
    const editorData = loaded.editorData ?? loaded.data;
    const baseData = loaded.baseData ?? loaded.data;
    const loadedText = dataToLevel0L(editorData);

    if (mode === "add" && level0lField.value.trim().length > 0) {
      state.baseData = mergeBaseData(state.baseData, baseData);
      level0lField.value = mergeLoadedDataIntoEditorText(level0lField.value, editorData);
    } else {
      state.baseData = baseData;
      level0lField.value = loadedText;
    }

    renderValidation(document.querySelector("#validation"), []);
    state.mapController?.refreshFromText();
    if (mapView) {
      state.mapController?.setView(mapView.lat, mapView.lon, mapView.zoom);
    }
    osmDataField.value = loaded.raw;
    const sourceLabel = loaded.sourceLabel
      ? `file ${loaded.sourceLabel}`
      : state.serverConfig.name;
    setStatus(statusElement, `Loaded ${editorData.length} object(s) from ${sourceLabel}.`, "success");
    persistWorkspaceState(urlInput, osmDataField, level0lField);
  } catch (error) {
    setStatus(statusElement, error.message, "error");
  }
}

function bindLoadControls(addButton, replaceButton, urlInput, fileInput, osmDataField, level0lField, statusElement) {
  addButton.addEventListener("click", async () => {
    await loadIntoEditor(urlInput, fileInput, osmDataField, level0lField, statusElement, "add");
  });

  replaceButton.addEventListener("click", async () => {
    await loadIntoEditor(urlInput, fileInput, osmDataField, level0lField, statusElement, "replace");
  });

  urlInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || event.isComposing) {
      return;
    }

    event.preventDefault();
    if (window.matchMedia("(pointer: coarse)").matches) {
      urlInput.blur();
    }
    removeUrlParameterFromAddress("center");
    await loadIntoEditor(urlInput, fileInput, osmDataField, level0lField, statusElement, "add");
  });
}

function bindEditorActions(
  revertButton,
  clearButton,
  validateButton,
  downloadButton,
  urlInput,
  fileInput,
  commentInput,
  osmDataField,
  level0lField,
  statusElement,
  validationElement,
  oscSectionElement,
  oscPreviewElement
) {
  revertButton.addEventListener("click", () => {
    setEditorFromBase(level0lField);
    renderValidation(validationElement, []);
    state.oscPreview = "";
    renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
    setStatus(statusElement, "Reverted editor contents to loaded base data.");
    persistWorkspaceState(urlInput, osmDataField, level0lField);
  });

  clearButton.addEventListener("click", () => {
    clearEditorState(
      urlInput,
      fileInput,
      commentInput,
      osmDataField,
      level0lField,
      statusElement,
      validationElement,
      oscSectionElement,
      oscPreviewElement
    );
    removeUrlParameterFromAddress("url");
  });

  validateButton.addEventListener("click", () => {
    try {
      const { validation } = parseEditor(level0lField);
      renderValidation(validationElement, validation);
      if (validation.length === 0) {
        setStatus(statusElement, "No validation errors found.", "success");
      } else {
        setStatus(statusElement, `Found ${validation.length} validation message(s).`);
      }
    } catch (error) {
      setStatus(statusElement, error.message, "error");
    }
  });

  downloadButton.addEventListener("click", () => {
    try {
      const uploadData = buildUploadData(level0lField, validationElement);
      downloadText("level0_export.osm", createOsm(uploadData));
      setStatus(statusElement, "Downloaded .osm export.", "success");
    } catch (error) {
      setStatus(statusElement, error.message, "error");
    }
  });
}

function bindUploadControl(
  uploadButton,
  splitUploadButton,
  commentInput,
  commentHistoryElement,
  level0lField,
  urlInput,
  osmDataField,
  statusElement,
  validationElement,
  oscSectionElement,
  oscPreviewElement
) {
  let uploadInProgress = false;

  const setUploadInProgress = (inProgress) => {
    uploadInProgress = inProgress;
    uploadButton.disabled = inProgress;
    splitUploadButton.disabled = inProgress;
  };

  commentInput.addEventListener("input", () => {
    saveCommentDraft(state.serverConfig, commentInput.value);
    cacheInitialDraft("comment", commentInput.value);
  });

  commentInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    uploadButton.click();
  });

  uploadButton.addEventListener("click", async () => {
    if (uploadInProgress) {
      return;
    }
    setUploadInProgress(true);
    try {
      const uploadData = buildUploadData(level0lField, validationElement);
      const pendingChanges = uploadData.filter((object) => object.action);

      if (pendingChanges.length === 0) {
        throw new Error("Nothing to upload.");
      }

      if (!commentInput.value.trim() && !uploadData.some((object) => object.type === "changeset" && object.id <= 0 && object.tags.comment)) {
        throw new Error("Please enter changeset comment.");
      }

      const result = await uploadPreparedDataOnce(
        uploadData,
        commentInput.value,
        state.serverConfig,
        statusElement,
        commentHistoryElement
      );

      setEditorFromBase(level0lField);
      commentInput.value = "";
      clearCommentDraft(state.serverConfig);
      cacheInitialDraft("comment", "");
      renderValidation(validationElement, []);
      state.oscPreview = "";
      renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
      persistWorkspaceState(urlInput, osmDataField, level0lField);
      setStatusWithLink(
        statusElement,
        "Changeset uploaded successfully: ",
        String(result.changesetId),
        `${state.serverConfig.siteUrl}/changeset/${result.changesetId}`,
        "success"
      );
    } catch (error) {
      setStatus(statusElement, error.message, "error");
    } finally {
      setUploadInProgress(false);
    }
  });

  splitUploadButton.addEventListener("click", async () => {
    if (uploadInProgress) {
      return;
    }
    setUploadInProgress(true);
    try {
      const uploadData = buildUploadData(level0lField, validationElement, { rejectWarnings: true });
      const pendingChanges = uploadData.filter((object) => object.action);

      if (pendingChanges.length === 0) {
        throw new Error("Nothing to upload.");
      }

      if (!commentInput.value.trim() && !uploadData.some((object) => object.type === "changeset" && object.id <= 0 && object.tags.comment)) {
        throw new Error("Please enter changeset comment.");
      }

      const splitPlan = await requestSplitUploadConfirmation(uploadData, state.baseData);

      if (!splitPlan) {
        state.mapController?.clearSplitPreview();
        setStatus(statusElement, "Split upload cancelled.");
        return;
      }

      const result = await uploadPreparedDataInGroups(
        uploadData,
        splitPlan.groups,
        commentInput.value,
        state.serverConfig,
        statusElement,
        urlInput,
        osmDataField,
        level0lField,
        commentHistoryElement
      );

      setEditorFromBase(level0lField);
      commentInput.value = "";
      clearCommentDraft(state.serverConfig);
      cacheInitialDraft("comment", "");
      renderValidation(validationElement, []);
      state.oscPreview = "";
      renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
      persistWorkspaceState(urlInput, osmDataField, level0lField);

      if (result.changesetIds.length > 1) {
        setStatusWithLinks(
          statusElement,
          "Uploaded split changesets: ",
          result.changesetIds.map((changesetId) => ({
            label: String(changesetId),
            url: `${state.serverConfig.siteUrl}/changeset/${changesetId}`
          })),
          "success"
        );
      } else {
        const changesetId = result.changesetIds[0];
        setStatusWithLink(
          statusElement,
          "Changeset uploaded successfully: ",
          String(changesetId),
          `${state.serverConfig.siteUrl}/changeset/${changesetId}`,
          "success"
        );
      }
    } catch (error) {
      setStatus(statusElement, error.message, "error");
    } finally {
      setUploadInProgress(false);
      state.mapController?.clearSplitPreview();
    }
  });
}

async function uploadPreparedDataOnce(uploadData, comment, serverConfig, statusElement, commentHistoryElement) {
  setStatus(statusElement, `Uploading changes to ${serverConfig.name}...`);
  const result = await uploadChanges(uploadData, comment, serverConfig);
  saveCommentHistory(serverConfig, comment);
  renderCommentHistory(commentHistoryElement);
  const syncedData = applyDiffResult(uploadData, result.diffResult);
  state.baseData = syncedData.filter((object) => object.type !== "changeset");
  return result;
}

async function uploadPreparedDataInGroups(
  uploadData,
  groups,
  comment,
  serverConfig,
  statusElement,
  urlInput,
  osmDataField,
  level0lField,
  commentHistoryElement
) {
  const changesetIds = [];
  let workingData = uploadData;

  for (let index = 0; index < groups.length; index += 1) {
    setStatus(
      statusElement,
      `Uploading changes to ${serverConfig.name} (${index + 1}/${groups.length})...`
    );

    const result = await uploadChanges(groups[index], comment, serverConfig);
    changesetIds.push(result.changesetId);
    saveCommentHistory(serverConfig, comment);
    renderCommentHistory(commentHistoryElement);
    workingData = applyDiffResult(workingData, result.diffResult);
    logSplitProgress(index + 1, groups.length, groups[index], result.changesetId);

    for (let remainingIndex = index + 1; remainingIndex < groups.length; remainingIndex += 1) {
      groups[remainingIndex] = remapPendingUploadData(groups[remainingIndex], result.diffResult);
    }

    state.baseData = workingData.filter(
      (object) => object.type !== "changeset" && !object.action
    );
    level0lField.value = dataToLevel0L(workingData);
    renderValidation(document.querySelector("#validation"), []);
    state.mapController?.refreshFromText();
    persistWorkspaceState(urlInput, osmDataField, level0lField);
  }

  return {
    changesetIds
  };
}

function renderSplitPlanSummary(splitPlan) {
  const totalObjects = splitPlan.groupSummaries.reduce((sum, group) => sum + group.objectCount, 0);
  const groupCount = splitPlan.groupSummaries.length;
  const objectLabel = totalObjects === 1 ? "object" : "objects";

  return {
    summary: groupCount > 1
      ? `This upload will be split into ${groupCount} changesets with ${totalObjects} ${objectLabel}.`
      : `This upload will be sent as one changeset with ${totalObjects} ${objectLabel}.`,
    items: splitPlan.groupSummaries.map((group, index) => ({
      index: index + 1,
      objectCount: group.objectCount,
      bbox: group.bbox
    }))
  };
}

function formatSplitBbox(bbox) {
  if (!bbox) {
    return "bbox unavailable";
  }

  const format = (value) => Number(value).toFixed(5);
  return `${format(bbox.minLat)}, ${format(bbox.minLon)} → ${format(bbox.maxLat)}, ${format(bbox.maxLon)}`;
}

function clampSplitGroupLimit(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 6;
  }

  return Math.min(10, Math.max(1, Math.trunc(numericValue)));
}

function requestSplitUploadConfirmation(uploadData, baseData) {
  const dialog = document.querySelector("#split-preview-dialog");
  const summaryElement = document.querySelector("#split-preview-summary");
  const listElement = document.querySelector("#split-preview-list");
  const closeButton = document.querySelector("#split-preview-close");
  const cancelButton = document.querySelector("#split-preview-cancel");
  const confirmButton = document.querySelector("#split-preview-confirm");
  const maxGroupsInput = document.querySelector("#split-preview-max-groups");
  const decreaseButton = document.querySelector("#split-preview-decrease");
  const increaseButton = document.querySelector("#split-preview-increase");

  if (!dialog || !summaryElement || !listElement || !closeButton || !cancelButton || !confirmButton || !maxGroupsInput || !decreaseButton || !increaseButton) {
    return Promise.resolve(
      window.confirm("Upload split changesets?") ? buildUploadSplitPlan(uploadData, baseData, {
        maxGroups: 6,
        minSplitSizeKm: 10
      }) : null
    );
  }

  let currentPlan = null;
  let lastValidMaxGroups = 6;

  const renderPlan = (splitPlan) => {
    const preview = renderSplitPlanSummary(splitPlan);
    summaryElement.textContent = preview.summary;
    listElement.replaceChildren(
      ...preview.items.map((item) => {
        const li = document.createElement("li");
        const objectLabel = item.objectCount === 1 ? "object" : "objects";
        li.textContent = `Part ${item.index}: ${item.objectCount} ${objectLabel}, ${formatSplitBbox(item.bbox)}`;
        return li;
      })
    );

    state.mapController?.renderSplitPreview(preview.items.map((item) => item.bbox));
  };

  const refreshPlan = () => {
    if (!maxGroupsInput.value) {
      return
    }
    const maxGroups = clampSplitGroupLimit(maxGroupsInput.value);
    maxGroupsInput.value = String(maxGroups);
    lastValidMaxGroups = maxGroups;
    decreaseButton.disabled = maxGroups <= 1;
    increaseButton.disabled = maxGroups >= 10;
    currentPlan = buildUploadSplitPlan(uploadData, baseData, {
      maxGroups,
      minSplitSizeKm: 10
    });
    renderPlan(currentPlan);
  };

  const objectCount = uploadData.filter((object) => object.type !== "changeset").length;
  const defaultMaxGroups = Math.min(6, Math.max(1, objectCount));
  maxGroupsInput.value = String(defaultMaxGroups);
  refreshPlan();

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = (confirmed) => {
      if (settled) {
        return;
      }

      settled = true;
      dialog.removeEventListener("close", onClose);
      dialog.removeEventListener("cancel", onCancel);
      maxGroupsInput.removeEventListener("input", onInput);
      maxGroupsInput.removeEventListener("change", onInput);
      decreaseButton.removeEventListener("click", onDecrease);
      increaseButton.removeEventListener("click", onIncrease);
      closeButton.removeEventListener("click", onCancelClick);
      cancelButton.removeEventListener("click", onCancelClick);
      confirmButton.removeEventListener("click", onConfirmClick);
      state.mapController?.clearSplitPreview();
      resolve(confirmed ? currentPlan : null);
    };

    const onInput = () => {
      refreshPlan();
    };

    const adjustMaxGroups = (amount) => {
      const current = maxGroupsInput.value ? clampSplitGroupLimit(maxGroupsInput.value) : lastValidMaxGroups;
      maxGroupsInput.value = String(clampSplitGroupLimit(current + amount));
      refreshPlan();
    };
    const onDecrease = () => adjustMaxGroups(-1);
    const onIncrease = () => adjustMaxGroups(1);

    const onConfirmClick = () => {
      dialog.close?.("confirm");
      cleanup(true);
    };

    const onCancelClick = () => {
      dialog.close?.("cancel");
      cleanup(false);
    };

    const onClose = () => {
      cleanup(dialog.returnValue === "confirm");
    };

    const onCancel = () => {
      cleanup(false);
    };

    dialog.addEventListener("close", onClose, { once: true });
    dialog.addEventListener("cancel", onCancel, { once: true });
    maxGroupsInput.addEventListener("input", onInput);
    maxGroupsInput.addEventListener("change", onInput);
    decreaseButton.addEventListener("click", onDecrease);
    increaseButton.addEventListener("click", onIncrease);
    closeButton.addEventListener("click", onCancelClick, { once: true });
    cancelButton.addEventListener("click", onCancelClick, { once: true });
    confirmButton.addEventListener("click", onConfirmClick, { once: true });

    if (typeof dialog.show === "function") {
      dialog.show();
      return;
    }

    dialog.setAttribute("open", "");
  });
}

function logSplitProgress(step, totalSteps, group, changesetId) {
  const counts = group.reduce((accumulator, object) => {
    if (object.type === "changeset") {
      accumulator.changeset += 1;
    } else if (object.action === "create") {
      accumulator.create += 1;
    } else if (object.action === "modify") {
      accumulator.modify += 1;
    } else if (object.action === "delete") {
      accumulator.delete += 1;
    } else {
      accumulator.clean += 1;
    }

    return accumulator;
  }, { changeset: 0, create: 0, modify: 0, delete: 0, clean: 0 });

  console.log("[upload-split] uploaded group", {
    step,
    totalSteps,
    changesetId,
    counts
  });
}

function bindSearchReplaceControl(
  openButton,
  panelWrap,
  closeButton,
  searchInput,
  replaceInput,
  regexCheckbox,
  countElement,
  previousButton,
  nextButton,
  replaceButton,
  applyButton,
  level0lField,
  urlInput,
  osmDataField,
  statusElement,
  validationElement,
  oscSectionElement,
  oscPreviewElement
) {
  const highlights = document.querySelector("#editor-highlights");
  const editorColumn = level0lField.parentElement;
  const searchPanel = panelWrap.querySelector(".search-replace-panel");
  const visualViewport = window.visualViewport;
  let lastViewportTop = visualViewport?.offsetTop ?? 0;
  let pendingMobileAlignment = false;
  let mobileAlignmentTimeout = null;
  let navigatedMatch = null;

  const alignMobileEditor = () => {
    if (panelWrap.hidden || !window.matchMedia("(max-width: 550px)").matches) {
      return;
    }
    const editorTop = level0lField.getBoundingClientRect().top;
    const panelBottom = searchPanel.getBoundingClientRect().bottom;
    window.scrollBy({ top: editorTop - panelBottom - 12, behavior: "instant" });
  };

  const syncVisualViewport = () => {
    const viewportTop = visualViewport.offsetTop;
    const shift = viewportTop - lastViewportTop;
    lastViewportTop = viewportTop;
    if (shift !== 0 && searchPanel.style.position === "fixed") {
      searchPanel.style.top = `${parseFloat(searchPanel.style.top) + shift}px`;
    }
  };
  visualViewport?.addEventListener("scroll", syncVisualViewport);
  visualViewport?.addEventListener("resize", () => {
    syncVisualViewport();
    if (pendingMobileAlignment && !panelWrap.hidden) {
      pendingMobileAlignment = false;
      requestAnimationFrame(alignMobileEditor);
    }
  });
  const syncHighlightSizeAndScroll = () => {
    highlights.style.left = `${level0lField.offsetLeft + level0lField.clientLeft}px`;
    highlights.style.top = `${level0lField.offsetTop + level0lField.clientTop}px`;
    highlights.style.width = `${level0lField.clientWidth}px`;
    highlights.style.height = `${level0lField.clientHeight}px`;
    highlights.scrollTop = level0lField.scrollTop;
    highlights.scrollLeft = level0lField.scrollLeft;
  };
  const refreshHighlights = () => {
    let matches = [];
    let replaceTarget = null;
    editorColumn.classList.toggle("is-searching", !panelWrap.hidden);
    if (!panelWrap.hidden) {
      try {
        matches = findSearchHighlights(level0lField.value, searchInput.value, regexCheckbox.checked);
        replaceTarget = navigatedMatch ?? (regexCheckbox.checked
          ? findLineRegexMatch(level0lField.value, searchInput.value)
          : findLiteralMatch(level0lField.value, searchInput.value));
      } catch {
        // Invalid expressions are reported by the match counter.
      }
    }
    const validationLines = new Map();
    for (const [isError, line] of state.validation ?? []) {
      if (isError || !validationLines.has(line)) {
        validationLines.set(line, isError ? "validation-error" : "validation-warning");
      }
    }
    const hasHighlights = matches.length > 0 || validationLines.size > 0;
    highlights.hidden = !hasHighlights;
    editorColumn.classList.toggle("is-highlighting", hasHighlights);
    if (!hasHighlights) {
      highlights.replaceChildren();
      return;
    }

    const text = level0lField.value;
    const fragment = document.createDocumentFragment();
    let lineStart = 0;
    let matchIndex = 0;
    const lines = text.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const lineEnd = lineStart + lines[lineIndex].length;
      const line = document.createElement("span");
      const severity = validationLines.get(lineIndex);
      if (severity) {
        line.className = severity;
      }
      let offset = lineStart;
      while (matchIndex < matches.length && matches[matchIndex].index < lineEnd) {
        const match = matches[matchIndex];
        const start = Math.max(offset, match.index);
        const end = Math.min(lineEnd, match.index + match.length);
        line.append(document.createTextNode(text.slice(offset, start)));
        const mark = document.createElement("mark");
        if (replaceTarget?.index === match.index && replaceTarget.length === match.length) {
          mark.classList.add("replace-target");
        }
        mark.textContent = text.slice(start, end);
        line.append(mark);
        offset = end;
        if (match.index + match.length > lineEnd) {
          break;
        }
        matchIndex += 1;
      }
      line.append(document.createTextNode(text.slice(offset, lineEnd)));
      fragment.append(line, document.createTextNode("\n"));
      while (matchIndex < matches.length && matches[matchIndex].index + matches[matchIndex].length <= lineEnd + 1) {
        matchIndex += 1;
      }
      lineStart = lineEnd + 1;
    }
    highlights.replaceChildren(fragment);
    syncHighlightSizeAndScroll();
  };
  state.refreshEditorHighlights = refreshHighlights;
  const refreshCount = () => {
    updateSearchReplaceCount(countElement, level0lField, searchInput, regexCheckbox, navigatedMatch);
    refreshHighlights();
  };
  level0lField.addEventListener("scroll", syncHighlightSizeAndScroll);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(syncHighlightSizeAndScroll).observe(level0lField);
  }
  const resizeFields = () => {
    autoResizeSearchReplaceTextarea(searchInput);
    autoResizeSearchReplaceTextarea(replaceInput);
  };
  const persistedSearchReplaceState = loadSearchReplaceState();

  searchInput.value = persistedSearchReplaceState.searchValue;
  replaceInput.value = persistedSearchReplaceState.replaceValue;
  regexCheckbox.checked = persistedSearchReplaceState.regexEnabled;
  let previousSearchValue = searchInput.value;
  let regexEnabledByTrailingDollar = false;
  let regexAutomaticallyEnabled = false;
  let automaticRegexSuppressed = false;

  openButton.setAttribute("aria-expanded", "false");

  openButton.addEventListener("click", () => {
    if (!panelWrap.hidden) {
      closeSearchReplacePanel(openButton, panelWrap);
      refreshHighlights();
      return;
    }
    openSearchReplacePanel(openButton, panelWrap, searchInput, level0lField, countElement, regexCheckbox);
    automaticRegexSuppressed = false;
    regexAutomaticallyEnabled = false;
    if (searchInput.value !== previousSearchValue) {
      previousSearchValue = searchInput.value;
      regexEnabledByTrailingDollar = false;
    }
    navigatedMatch = null;
    resizeFields();
    refreshCount();
    persistSearchReplaceState(searchInput, replaceInput, regexCheckbox);
    if (window.matchMedia("(max-width: 550px)").matches) {
      pendingMobileAlignment = true;
      clearTimeout(mobileAlignmentTimeout);
      mobileAlignmentTimeout = setTimeout(() => {
        pendingMobileAlignment = false;
      }, 1000);
      requestAnimationFrame(alignMobileEditor);
    }
  });

  closeButton.addEventListener("click", () => {
    closeSearchReplacePanel(openButton, panelWrap);
    refreshHighlights();
  });

  document.addEventListener("click", (event) => {
    if (!panelWrap.hidden && !panelWrap.contains(event.target) && !openButton.contains(event.target)) {
      closeSearchReplacePanel(openButton, panelWrap);
      refreshHighlights();
    }
  });

  searchInput.addEventListener("input", () => {
    navigatedMatch = null;
    if (!automaticRegexSuppressed) {
      const wasEnabled = regexCheckbox.checked;
      const regexMode = updateAutomaticRegexMode(
        previousSearchValue, searchInput.value, wasEnabled, regexEnabledByTrailingDollar
      );
      if (!wasEnabled && regexMode.enabled) {
        regexAutomaticallyEnabled = true;
      } else if (!regexMode.enabled) {
        regexAutomaticallyEnabled = false;
      }
      regexCheckbox.checked = regexMode.enabled;
      regexEnabledByTrailingDollar = regexMode.enabledByTrailingDollar;
    }
    previousSearchValue = searchInput.value;
    autoResizeSearchReplaceTextarea(searchInput);
    persistSearchReplaceState(searchInput, replaceInput, regexCheckbox);
    refreshCount();
  });
  replaceInput.addEventListener("input", () => {
    autoResizeSearchReplaceTextarea(replaceInput);
    persistSearchReplaceState(searchInput, replaceInput, regexCheckbox);
    refreshCount();
  });
  regexCheckbox.addEventListener("change", () => {
    navigatedMatch = null;
    if (!regexCheckbox.checked && regexAutomaticallyEnabled) {
      automaticRegexSuppressed = true;
    }
    regexAutomaticallyEnabled = false;
    regexEnabledByTrailingDollar = false;
    persistSearchReplaceState(searchInput, replaceInput, regexCheckbox);
    refreshCount();
  });
  level0lField.addEventListener("input", () => {
    navigatedMatch = null;
    if (state.validation?.length) {
      renderValidation(validationElement, []);
    }
    refreshCount();
  });

  const moveToMatch = (direction, keepButtonFocus = false) => {
    const search = searchInput.value;
    if (search.length === 0) {
      setStatus(statusElement, "Enter text to search for.", "error");
      return;
    }

    const regexEnabled = regexCheckbox.checked;
    const findMatch = (startIndex) => regexEnabled
      ? findLineRegexMatch(level0lField.value, search, startIndex)
      : findLiteralMatch(level0lField.value, search, startIndex);
    try {
      const current = navigatedMatch ?? findMatch(0);
      if (current === null) {
        setStatus(statusElement, "No matches found.");
        return;
      }
      const match = direction === "next"
        ? (findMatch(current.index + Math.max(current.length, 1)) ?? findMatch(0))
        : (findPreviousSearchMatch(findMatch, current.index)
          ?? findPreviousSearchMatch(findMatch, level0lField.value.length + 1));

      if (match === null) {
        setStatus(statusElement, "No matches found.");
        return;
      }

      navigatedMatch = match;
      refreshCount();
      if (!keepButtonFocus) {
        level0lField.focus({ preventScroll: true });
      }
      level0lField.setSelectionRange(match.index, match.index + match.length);
    } catch (error) {
      setStatus(statusElement, error.message, "error");
    }
  };

  for (const button of [previousButton, nextButton]) {
    button.addEventListener("pointerdown", (event) => {
      if (event.button === 0 && document.activeElement === level0lField) {
        event.preventDefault();
      }
    });
    button.addEventListener("mousedown", (event) => {
      if (event.button === 0 && document.activeElement === level0lField) {
        event.preventDefault();
      }
    });
  }

  previousButton.addEventListener("click", (event) => {
    preservePageScroll(window, () => moveToMatch("previous", event.detail === 0));
  });

  nextButton.addEventListener("click", (event) => {
    preservePageScroll(window, () => moveToMatch("next", event.detail === 0));
  });

  const replaceMatches = (replaceAll) => {
    const search = searchInput.value;
    if (search.length === 0) {
      setStatus(statusElement, "Enter text to search for.", "error");
      return;
    }

    const regexEnabled = regexCheckbox.checked;
    let occurrences = 0;

    try {
      occurrences = regexEnabled
        ? countLineRegexOccurrences(level0lField.value, search)
        : countLiteralOccurrences(level0lField.value, search);
    } catch (error) {
      setStatus(statusElement, error.message, "error");
      refreshCount();
      return;
    }

    if (occurrences === 0) {
      setStatus(statusElement, "No matches found.");
      refreshCount();
      return;
    }

    const originalText = level0lField.value;
    const replacedMatch = replaceAll
      ? null
      : (navigatedMatch ?? (regexEnabled
        ? findLineRegexMatch(originalText, search)
        : findLiteralMatch(originalText, search)));

    const updatedText = replaceAll
      ? (regexEnabled
        ? replaceAllLineRegex(originalText, search, replaceInput.value)
        : replaceAllLiteral(originalText, search, replaceInput.value))
      : replaceSearchMatch(originalText, search, replaceInput.value, regexEnabled, replacedMatch);

    if (updatedText !== originalText) {
      if (!applyEditorReplacement(level0lField, updatedText, replaceAll, navigator, document)) {
        setStatus(statusElement, "Could not replace text with undo support in this browser.", "error");
        return;
      }
    }
    state.mapController?.refreshFromText();
    state.oscPreview = "";
    renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
    renderValidation(validationElement, []);
    persistWorkspaceState(urlInput, osmDataField, level0lField);
    refreshCount();
    setStatus(statusElement, `Replaced ${replaceAll ? occurrences : 1} occurrence(s).`, "success");

    if (!replaceAll && replacedMatch !== null) {
      const suffixLength = originalText.length - (replacedMatch.index + replacedMatch.length);
      const nextSearchStart = level0lField.value.length - suffixLength;
      const nextMatch = regexEnabled
        ? findLineRegexMatch(level0lField.value, search, nextSearchStart)
        : findLiteralMatch(level0lField.value, search, nextSearchStart);
      navigatedMatch = nextMatch;
      refreshCount();
      const caretPosition = nextMatch?.index ?? nextSearchStart;

      level0lField.focus({ preventScroll: true });
      level0lField.setSelectionRange(caretPosition, caretPosition);
    }
  };

  replaceButton.addEventListener("click", (event) => {
    const keepButtonFocus = event.detail === 0;
    preservePageScroll(window, () => {
      try {
        replaceMatches(false);
      } finally {
        if (keepButtonFocus) {
          replaceButton.focus({ preventScroll: true });
        }
      }
    });
  });

  applyButton.addEventListener("click", () => {
    replaceMatches(true);
  });

  refreshCount();
}

document.addEventListener("DOMContentLoaded", async () => {
  state.serverConfig = loadServerConfig();

  const loginButton = document.querySelector("#login");
  const logoutButton = document.querySelector("#logout");
  const addButton = document.querySelector("#add");
  const replaceButton = document.querySelector("#replace");
  const revertButton = document.querySelector("#revert");
  const clearButton = document.querySelector("#clear");
  const validateButton = document.querySelector("#validate");
  const downloadButton = document.querySelector("#download");
  const convertButton = document.querySelector("#convert");
  const uploadButton = document.querySelector("#upload");
  const splitUploadButton = document.querySelector("#split-upload");
  const searchReplaceOpenButton = document.querySelector("#search-replace-open");
  const searchReplacePanelWrap = document.querySelector("#search-replace-panel-wrap");
  const searchReplaceCloseButton = document.querySelector("#search-replace-close");
  const searchReplaceSearchInput = document.querySelector("#search-replace-search");
  const searchReplaceReplaceInput = document.querySelector("#search-replace-replace");
  const searchReplaceRegexCheckbox = document.querySelector("#search-replace-regex");
  const searchReplaceCount = document.querySelector("#search-replace-count");
  const searchReplacePreviousButton = document.querySelector("#search-replace-previous");
  const searchReplaceNextButton = document.querySelector("#search-replace-next");
  const searchReplaceButton = document.querySelector("#search-replace-one");
  const searchReplaceApplyButton = document.querySelector("#search-replace-apply");
  const commentHistoryElement = document.querySelector("#comment-history");
  const urlInput = document.querySelector("#url-input");
  const fileInput = document.querySelector("#file-input");
  const commentInput = document.querySelector("#comment-input");
  const osmDataField = document.querySelector("#osmdata");
  const level0lField = document.querySelector("#level0l");
  const coordsInput = document.querySelector("#coords");
  const centerInput = document.querySelector("#center-input");
  const mapElement = document.querySelector("#map");
  const mapToEditorButton = document.querySelector("#map-to-editor");
  const coord2textButton = document.querySelector("#coord2text");
  const downareaButton = document.querySelector("#downarea");
  const projectInfoOpenButton = document.querySelector("#project-info-open");
  const projectInfoDialog = document.querySelector("#project-info-dialog");
  const projectInfoDialogHeader = document.querySelector("#project-info-dialog .project-dialog-header");
  const projectInfoCloseButton = document.querySelector("#project-info-close");
  const splitPreviewDialog = document.querySelector("#split-preview-dialog");
  const splitPreviewDialogHeader = document.querySelector("#split-preview-dialog .project-dialog-header");
  const searchReplacePanel = document.querySelector(".search-replace-panel");
  const searchReplaceHeader = document.querySelector(".search-replace-header");
  const statusElement = document.querySelector("#status");
  const validationElement = document.querySelector("#validation");
  const oscSectionElement = document.querySelector("#osc-section");
  const oscPreviewElement = document.querySelector("#osc-preview");

  mapToEditorButton.addEventListener("click", () => {
    level0lField.scrollIntoView({ block: "start", behavior: "smooth" });
  });

  const serverFormElements = {
    container: document.querySelector(".server-settings"),
    backdrop: document.querySelector(".server-settings-backdrop"),
    panel: document.querySelector(".server-settings-panel"),
    header: document.querySelector(".server-settings-header"),
    closeButton: document.querySelector("#server-settings-close"),
    presetSelect: document.querySelector("#server-preset"),
    nameInput: document.querySelector("#server-name"),
    siteUrlInput: document.querySelector("#server-site-url"),
    apiBaseInput: document.querySelector("#server-api-base"),
    clientIdInput: document.querySelector("#oauth-client-id"),
    defaultBaseLayerUrlInput: document.querySelector("#default-base-layer-url"),
    tokenInput: document.querySelector("#oauth-token"),
    themeSelect: document.querySelector("#theme-select"),
    serverLabel: document.querySelector("#current-server-label"),
    commentInput
  };
  serverFormElements.editableInputs = [
    serverFormElements.nameInput,
    serverFormElements.siteUrlInput,
    serverFormElements.apiBaseInput,
    serverFormElements.clientIdInput,
    serverFormElements.defaultBaseLayerUrlInput
  ];
  serverFormElements.lockableInputs = [
    serverFormElements.nameInput,
    serverFormElements.siteUrlInput,
    serverFormElements.apiBaseInput,
    serverFormElements.clientIdInput,
    serverFormElements.defaultBaseLayerUrlInput
  ];

  applyThemePreference(loadThemePreference());
  renderServerInfo();
  await ensureDraftStorageReady();
  renderServerSettings(serverFormElements, state.serverConfig);
  renderThemeSettings(serverFormElements.themeSelect);
  syncCommentDraft(commentInput);
  renderCommentHistory(commentHistoryElement);
  restoreWorkspaceState(
    urlInput,
    osmDataField,
    level0lField,
    validationElement,
    oscSectionElement,
    oscPreviewElement
  );
  state.mapController = initMapEditor({
    mapElement,
    coordsInput,
    centerInput,
    textarea: level0lField,
    coord2textButton,
    downareaButton,
    urlInput,
    defaultBaseLayer: state.serverConfig.defaultBaseLayer,
    onEditError: (message) => setStatus(statusElement, message, "error"),
    onDownloadArea: async (reference) => {
      urlInput.value = reference;
      fileInput.value = "";
      await loadIntoEditor(urlInput, fileInput, osmDataField, level0lField, statusElement, "replace");
    }
  });
  const mapCenter = parseMapCenterParameter(new URLSearchParams(window.location.search).get("center"));
  if (mapCenter) {
    clearLoadedEditorData(
      osmDataField,
      level0lField,
      validationElement,
      oscSectionElement,
      oscPreviewElement
    );
    const zoom = Math.max(state.mapController?.getZoom() ?? 17, 17);
    state.mapController?.setView(mapCenter.lat, mapCenter.lon, zoom);
  }
  state.mapController?.refreshFromText();

  const storedUserName = getStoredUserName(state.serverConfig) ?? "";
  if (storedUserName.length > 0) {
    setLoginState(loginButton, storedUserName);
  }

  bindAuthControls(loginButton, logoutButton);
  bindProjectInfo(projectInfoOpenButton, projectInfoDialog, projectInfoCloseButton);
  bindDraggableDialog(projectInfoDialog, projectInfoDialogHeader);
  bindDraggableDialog(splitPreviewDialog, splitPreviewDialogHeader);
  bindDraggableDialog(searchReplacePanel, searchReplaceHeader);
  bindDraggableDialog(serverFormElements.panel, serverFormElements.header);
  serverFormElements.closeButton?.addEventListener("click", () => {
    serverFormElements.container.open = false;
  });
  serverFormElements.backdrop?.addEventListener("click", () => {
    serverFormElements.container.open = false;
  });
  bindThemeSettings(serverFormElements.themeSelect);
  bindWorkspacePersistence(urlInput, osmDataField, level0lField);
  bindDiffControl(
    document.querySelector("#diff-toggle"),
    document.querySelector("#diff-panel"),
    document.querySelector("#diff-content"),
    level0lField,
    urlInput,
    osmDataField,
    statusElement,
    validationElement,
    oscSectionElement,
    oscPreviewElement
  );
  bindSearchReplaceControl(
    searchReplaceOpenButton,
    searchReplacePanelWrap,
    searchReplaceCloseButton,
    searchReplaceSearchInput,
    searchReplaceReplaceInput,
    searchReplaceRegexCheckbox,
    searchReplaceCount,
    searchReplacePreviousButton,
    searchReplaceNextButton,
    searchReplaceButton,
    searchReplaceApplyButton,
    level0lField,
    urlInput,
    osmDataField,
    statusElement,
    validationElement,
    oscSectionElement,
    oscPreviewElement
  );
  commentInput.addEventListener("focus", () => {
    renderCommentHistory(commentHistoryElement);
  });
  bindServerSettings(
    serverFormElements,
    loginButton,
    statusElement,
    commentHistoryElement,
    urlInput,
    fileInput,
    commentInput,
    osmDataField,
    level0lField,
    validationElement,
    oscSectionElement,
    oscPreviewElement
  );
  bindConvertControl(convertButton, urlInput, osmDataField, level0lField, statusElement, validationElement);
  bindLoadControls(addButton, replaceButton, urlInput, fileInput, osmDataField, level0lField, statusElement);
  bindEditorActions(
    revertButton,
    clearButton,
    validateButton,
    downloadButton,
    urlInput,
    fileInput,
    commentInput,
    osmDataField,
    level0lField,
    statusElement,
    validationElement,
    oscSectionElement,
    oscPreviewElement
  );
  bindUploadControl(
    uploadButton,
    splitUploadButton,
    commentInput,
    commentHistoryElement,
    level0lField,
    urlInput,
    osmDataField,
    statusElement,
    validationElement,
    oscSectionElement,
    oscPreviewElement
  );

  const { overpassUrl } = await restoreSession(loginButton);
  if (overpassUrl) {
    clearEditorState(
      urlInput,
      fileInput,
      commentInput,
      osmDataField,
      level0lField,
      statusElement,
      validationElement,
      oscSectionElement,
      oscPreviewElement
    );
    setEditorLocked(level0lField, true);
    setStatus(statusElement, `Loading data from URL parameter...`);

    try {
      const loaded = await loadSupportedUrl(overpassUrl, state.serverConfig);
      state.baseData = loaded.data;
      osmDataField.value = loaded.raw;
      level0lField.value = osmDataToL0L(loaded.data);
      state.mapController?.refreshFromText();
      persistWorkspaceState(urlInput, osmDataField, level0lField);
      setStatus(statusElement, `Loaded ${loaded.data.length} object(s) from ${state.serverConfig.name}.`);
    } catch (error) {
      setStatus(statusElement, error.message, "error");
    } finally {
      setEditorLocked(level0lField, false);
    }
  }
});
