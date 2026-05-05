const SERVER_SETTINGS_KEY = "server_settings_v1";
const OAUTH_AUTHORIZATION_ENDPOINT = "/oauth2/authorize";
const OAUTH_TOKEN_ENDPOINT = "/oauth2/token";
const OAUTH_REVOKE_ENDPOINT = "/oauth2/revoke";

export const BUILTIN_SERVER_PRESETS = {
  osm: {
    presetId: "osm",
    name: "OpenStreetMap",
    siteUrl: "https://www.openstreetmap.org",
    apiBase: "https://api.openstreetmap.org/api/0.6/",
    clientId: "4iG7gjwlubrNNwO0nQI-KlKf76ihN9BIzo0PMzlfkDY"
  },
  "osm-dev": {
    presetId: "osm-dev",
    name: "OpenStreetMap Dev",
    siteUrl: "https://master.apis.dev.openstreetmap.org",
    apiBase: "https://master.apis.dev.openstreetmap.org/api/0.6/",
    clientId: "HgTl3HZ4bSyD6md01peniJWFNWg4FAWzIcTcq2UJFDI"
  },
  ohm: {
    presetId: "ohm",
    name: "OpenHistoricalMap",
    siteUrl: "https://www.openhistoricalmap.org",
    apiBase: "https://www.openhistoricalmap.org/api/0.6/",
    clientId: "OK9rjxVfEx-CdL0LnYSsh1IojKJyizugJJZMLtSFzjw"
  },
  ogf: {
    presetId: "ogf",
    name: "OpenGeofiction",
    siteUrl: "https://opengeofiction.net",
    apiBase: "https://opengeofiction.net/api/0.6/",
    clientId: "69zxKnC1pupOQ14ZLvjAiWE9jNWutjzJSzUGFRorWmY"
  },
  custom: {
    presetId: "custom",
    name: "Custom",
    siteUrl: "https://www.openstreetmap.org",
    apiBase: "https://api.openstreetmap.org/api/0.6/",
    clientId: ""
  }
};

export const DEFAULT_SERVER_PRESET_ID = "osm-dev";

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function normalizeServerConfig(config) {
  const presetId = config.presetId && BUILTIN_SERVER_PRESETS[config.presetId] ? config.presetId : "custom";
  const fallback = BUILTIN_SERVER_PRESETS[presetId] ?? BUILTIN_SERVER_PRESETS.custom;
  const siteUrl = trimTrailingSlash(config.siteUrl?.trim?.() || fallback.siteUrl);
  let apiBase = config.apiBase?.trim?.() || fallback.apiBase;
  apiBase = apiBase.endsWith("/") ? apiBase : `${apiBase}/`;

  return {
    presetId,
    name: (config.name?.trim?.() || fallback.name),
    siteUrl,
    apiBase,
    authorizationEndpoint: OAUTH_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: OAUTH_TOKEN_ENDPOINT,
    revokeEndpoint: OAUTH_REVOKE_ENDPOINT,
    clientId: config.clientId ?? fallback.clientId
  };
}

export function getPresetServerConfig(presetId) {
  return normalizeServerConfig(BUILTIN_SERVER_PRESETS[presetId] ?? BUILTIN_SERVER_PRESETS.custom);
}

export function getDefaultServerConfig() {
  return getPresetServerConfig(DEFAULT_SERVER_PRESET_ID);
}

export function resolveServerEndpoint(serverConfig, endpoint) {
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }

  const baseUrl = trimTrailingSlash(serverConfig.siteUrl);
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${baseUrl}${path}`;
}

export function getServerStorageKey(serverConfig) {
  return `${serverConfig.siteUrl}|${serverConfig.apiBase}`;
}

export function loadServerConfig() {
  if (typeof localStorage === "undefined") {
    return getDefaultServerConfig();
  }

  try {
    const raw = localStorage.getItem(SERVER_SETTINGS_KEY);
    if (!raw) {
      return getDefaultServerConfig();
    }

    return normalizeServerConfig(JSON.parse(raw));
  } catch {
    return getDefaultServerConfig();
  }
}

export function saveServerConfig(serverConfig) {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(SERVER_SETTINGS_KEY, JSON.stringify(normalizeServerConfig(serverConfig)));
}
