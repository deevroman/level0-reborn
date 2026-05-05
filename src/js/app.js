import { loadIncompleteRelationData, loadSupportedFile, loadSupportedUrl } from "./api.js";
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
  loadCommentDraft,
  loadWorkspaceState,
  saveCommentDraft,
  saveWorkspaceState
} from "./draft-storage.js";
import {
  applyDiffResult,
  indexBaseData,
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
import { uploadChanges } from "./upload.js";
import { parseMapViewReference } from "./url.js";

const THEME_STORAGE_KEY = "theme_preference_v1";

const state = {
  baseData: [],
  oscPreview: "",
  mapController: null,
  serverConfig: normalizeServerConfig(BUILTIN_SERVER_PRESETS["osm-dev"])
};

function loadThemePreference() {
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === "light" || storedTheme === "dark" ? storedTheme : "auto";
  } catch {
    return "auto";
  }
}

function applyThemePreference(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function saveThemePreference(theme) {
  try {
    if (theme === "light" || theme === "dark") {
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
  loginButton.textContent = isLoggedIn ? `You're ${userName}` : "Log in";
  loginButton.disabled = isLoggedIn;
  loginButton.dataset.authReady = "true";
}

function setLoginButtonPending(loginButton, message) {
  loginButton.textContent = message;
  loginButton.disabled = true;
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

function setStatus(statusElement, message, type = "info") {
  statusElement.dataset.type = type;
  statusElement.replaceChildren(document.createTextNode(message));
}

function clearStatus(statusElement) {
  setStatus(statusElement, "", "info");
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

function renderValidation(validationElement, validation) {
  validationElement.replaceChildren();

  for (const [isError, line, message] of validation) {
    const item = document.createElement("p");
    item.className = "validation-item";
    item.dataset.severity = isError ? "error" : "warning";
    item.textContent = `Line ${line + 1}: ${message}`;
    validationElement.append(item);
  }
}

function renderOscPreview(sectionElement, previewElement, oscText) {
  sectionElement.hidden = oscText.length === 0;
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

function buildUploadData(level0lField, validationElement) {
  const { data, validation } = parseEditor(level0lField);
  renderValidation(validationElement, validation);

  if (validation.some(([isError]) => isError)) {
    throw new Error("There are severe validation errors, please fix them.");
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

function syncCommentDraft(commentInput) {
  commentInput.value = loadCommentDraft(state.serverConfig);
}

function persistWorkspaceState(urlInput, osmDataField, level0lField) {
  saveWorkspaceState({
    urlValue: urlInput.value,
    osmDataValue: osmDataField.value,
    level0lValue: level0lField.value,
    baseData: state.baseData,
    oscPreview: state.oscPreview
  });
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
  if (!workspaceState) {
    return;
  }

  urlInput.value = workspaceState.urlValue;
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
  osmDataField.value = "";
  level0lField.value = "";
  state.mapController?.refreshFromText();
  renderValidation(validationElement, []);
  renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
  clearStatus(statusElement);
  clearWorkspaceState();
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
    clientId: formElements.clientIdInput.value
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
  loginButton.addEventListener("click", () => {
    setLoginButtonPending(loginButton, "Redirecting...");
    login(state.serverConfig);
  });

  logoutButton.addEventListener("click", async () => {
    await logout(state.serverConfig);
    setLoginState(loginButton);
  });
}

function bindServerSettings(
  formElements,
  loginButton,
  statusElement,
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
        setStatus(statusElement, "Switch to OpenStreetMap Dev was cancelled.");
        return;
      }

      try {
        await completeIncompleteRelationsForServerSwitch(level0lField, osmDataField, previousConfig);
      } catch (error) {
        renderServerSettings(formElements, previousConfig);
        syncCommentDraft(formElements.commentInput);
        setStatus(statusElement, error.message, "error");
        return;
      }
    }

    if (formElements.presetSelect.value === "custom") {
      state.serverConfig = readServerSettings(formElements, "custom");
    } else {
      state.serverConfig = normalizeServerConfig(BUILTIN_SERVER_PRESETS[formElements.presetSelect.value]);
      renderServerSettings(formElements, state.serverConfig);
    }

    saveServerConfig(state.serverConfig);
    syncCommentDraft(formElements.commentInput);
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
      state.serverConfig = readServerSettings(formElements, "custom");
      saveServerConfig(state.serverConfig);
      renderServerSettings(formElements, state.serverConfig);
      syncCommentDraft(formElements.commentInput);
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

  urlInput.addEventListener("keypress", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    await loadIntoEditor(urlInput, fileInput, osmDataField, level0lField, statusElement, "add");
  });
}

function bindEditorActions(
  revertButton,
  clearButton,
  validateButton,
  showOscButton,
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

  showOscButton.addEventListener("click", () => {
    try {
      const uploadData = buildUploadData(level0lField, validationElement);
      state.oscPreview = createOsc(uploadData, 1234);
      renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
      setStatus(statusElement, "Built osmChange preview.");
      persistWorkspaceState(urlInput, osmDataField, level0lField);
    } catch (error) {
      state.oscPreview = "";
      renderOscPreview(oscSectionElement, oscPreviewElement, state.oscPreview);
      setStatus(statusElement, error.message, "error");
      persistWorkspaceState(urlInput, osmDataField, level0lField);
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
  commentInput,
  level0lField,
  urlInput,
  osmDataField,
  statusElement,
  validationElement,
  oscSectionElement,
  oscPreviewElement
) {
  commentInput.addEventListener("input", () => {
    saveCommentDraft(state.serverConfig, commentInput.value);
  });

  commentInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    uploadButton.click();
  });

  uploadButton.addEventListener("click", async () => {
    try {
      const uploadData = buildUploadData(level0lField, validationElement);
      const pendingChanges = uploadData.filter((object) => object.action);

      if (pendingChanges.length === 0) {
        throw new Error("Nothing to upload.");
      }

      if (!commentInput.value.trim() && !uploadData.some((object) => object.type === "changeset" && object.id <= 0 && object.tags.comment)) {
        throw new Error("Please enter changeset comment.");
      }

      setStatus(statusElement, `Uploading changes to ${state.serverConfig.name}...`);
      const result = await uploadChanges(uploadData, commentInput.value, state.serverConfig);
      const syncedData = applyDiffResult(uploadData, result.diffResult);
      state.baseData = syncedData.filter((object) => object.type !== "changeset");
      setEditorFromBase(level0lField);
      commentInput.value = "";
      clearCommentDraft(state.serverConfig);
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
    }
  });
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
  const showOscButton = document.querySelector("#show-osc");
  const downloadButton = document.querySelector("#download");
  const convertButton = document.querySelector("#convert");
  const uploadButton = document.querySelector("#upload");
  const urlInput = document.querySelector("#url-input");
  const fileInput = document.querySelector("#file-input");
  const commentInput = document.querySelector("#comment-input");
  const osmDataField = document.querySelector("#osmdata");
  const level0lField = document.querySelector("#level0l");
  const coordsInput = document.querySelector("#coords");
  const centerInput = document.querySelector("#center-input");
  const mapElement = document.querySelector("#map");
  const coord2textButton = document.querySelector("#coord2text");
  const downareaButton = document.querySelector("#downarea");
  const projectInfoOpenButton = document.querySelector("#project-info-open");
  const projectInfoDialog = document.querySelector("#project-info-dialog");
  const projectInfoCloseButton = document.querySelector("#project-info-close");
  const statusElement = document.querySelector("#status");
  const validationElement = document.querySelector("#validation");
  const oscSectionElement = document.querySelector("#osc-section");
  const oscPreviewElement = document.querySelector("#osc-preview");

  const serverFormElements = {
    container: document.querySelector(".server-settings"),
    backdrop: document.querySelector(".server-settings-backdrop"),
    presetSelect: document.querySelector("#server-preset"),
    nameInput: document.querySelector("#server-name"),
    siteUrlInput: document.querySelector("#server-site-url"),
    apiBaseInput: document.querySelector("#server-api-base"),
    clientIdInput: document.querySelector("#oauth-client-id"),
    tokenInput: document.querySelector("#oauth-token"),
    themeSelect: document.querySelector("#theme-select"),
    serverLabel: document.querySelector("#current-server-label"),
    commentInput
  };
  serverFormElements.editableInputs = [
    serverFormElements.nameInput,
    serverFormElements.siteUrlInput,
    serverFormElements.apiBaseInput,
    serverFormElements.clientIdInput
  ];
  serverFormElements.lockableInputs = [
    serverFormElements.nameInput,
    serverFormElements.siteUrlInput,
    serverFormElements.apiBaseInput,
    serverFormElements.clientIdInput
  ];

  applyThemePreference(loadThemePreference());
  renderServerInfo();
  renderServerSettings(serverFormElements, state.serverConfig);
  renderThemeSettings(serverFormElements.themeSelect);
  syncCommentDraft(commentInput);
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
    onDownloadArea: async (reference) => {
      urlInput.value = reference;
      fileInput.value = "";
      await loadIntoEditor(urlInput, fileInput, osmDataField, level0lField, statusElement, "replace");
    }
  });
  state.mapController?.refreshFromText();

  const storedUserName = getStoredUserName(state.serverConfig) ?? "";
  if (storedUserName.length > 0) {
    setLoginState(loginButton, storedUserName);
  }

  bindAuthControls(loginButton, logoutButton);
  bindProjectInfo(projectInfoOpenButton, projectInfoDialog, projectInfoCloseButton);
  bindThemeSettings(serverFormElements.themeSelect);
  bindWorkspacePersistence(urlInput, osmDataField, level0lField);
  bindServerSettings(
    serverFormElements,
    loginButton,
    statusElement,
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
    showOscButton,
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
    commentInput,
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
    const loaded = await loadSupportedUrl(overpassUrl, state.serverConfig);
    state.baseData = loaded.data;
    osmDataField.value = loaded.raw;
    level0lField.value = osmDataToL0L(loaded.data);
    state.mapController?.refreshFromText();
    persistWorkspaceState(urlInput, osmDataField, level0lField);
    setStatus(statusElement, `Loaded ${loaded.data.length} object(s) from ${state.serverConfig.name}.`);
  }
});
