import {
  getDefaultServerConfig,
  getServerStorageKey,
  resolveServerEndpoint
} from "./server-config.js";

const ACCESS_TOKEN_KEY_PREFIX = "access_token";
const USER_NAME_KEY_PREFIX = "osm_user_name";
const OAUTH_SCOPE = "read_prefs write_api";

function getAccessTokenStorageKey(serverConfig) {
  return `${ACCESS_TOKEN_KEY_PREFIX}:${getServerStorageKey(serverConfig)}`;
}

function getUserNameStorageKey(serverConfig) {
  return `${USER_NAME_KEY_PREFIX}:${getServerStorageKey(serverConfig)}`;
}

export function getOAuthRedirectUri(locationLike = window.location) {
  const pathname = locationLike.pathname.endsWith("/") && locationLike.pathname !== "/"
    ? locationLike.pathname.slice(0, -1)
    : locationLike.pathname;
  return `${locationLike.origin}${pathname}`;
}

function buildAuthParams(serverConfig) {
  return {
    client_id: serverConfig.clientId,
    redirect_uri: getOAuthRedirectUri(),
    scope: OAUTH_SCOPE,
    response_type: "code"
  };
}

export function login(serverConfig = getDefaultServerConfig()) {
  const params = new URLSearchParams(buildAuthParams(serverConfig));
  window.location = `${resolveServerEndpoint(serverConfig, serverConfig.authorizationEndpoint)}?${params.toString()}`;
}

export function clearStoredAuth(serverConfig = getDefaultServerConfig()) {
  localStorage.removeItem(getAccessTokenStorageKey(serverConfig));
  localStorage.removeItem(getUserNameStorageKey(serverConfig));
}

export async function logout(serverConfig = getDefaultServerConfig(), fetchImpl = fetch) {
  const accessToken = getStoredAccessToken(serverConfig);
  if (!accessToken) {
    clearStoredAuth(serverConfig);
    return null;
  }

  const response = await fetchImpl(resolveServerEndpoint(serverConfig, serverConfig.revokeEndpoint), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      token: accessToken,
      client_id: serverConfig.clientId
    }).toString()
  });

  clearStoredAuth(serverConfig);

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

export async function exchangeAuthCodeForToken(code, serverConfig = getDefaultServerConfig(), fetchImpl = fetch) {
  const tokenParams = {
    client_id: serverConfig.clientId,
    redirect_uri: getOAuthRedirectUri(),
    code,
    grant_type: "authorization_code"
  };

  const response = await fetchImpl(resolveServerEndpoint(serverConfig, serverConfig.tokenEndpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams(tokenParams).toString()
  });

  const json = await response.json();
  if (!json.access_token) {
    throw new Error("OSM OAuth did not return an access_token");
  }

  return json.access_token;
}

export function getStoredAccessToken(serverConfig = getDefaultServerConfig()) {
  return localStorage.getItem(getAccessTokenStorageKey(serverConfig));
}

export function storeAccessToken(accessToken, serverConfig = getDefaultServerConfig()) {
  localStorage.setItem(getAccessTokenStorageKey(serverConfig), accessToken);
}

export async function fetchCurrentUserName(accessToken, serverConfig = getDefaultServerConfig(), fetchImpl = fetch) {
  const response = await fetchImpl(`${serverConfig.apiBase}user/details`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch current user details: ${response.status}`);
  }

  const xml = await response.text();
  const match = xml.match(/\bdisplay_name="([^"]+)"/);
  if (!match) {
    throw new Error("OSM user details did not contain display_name");
  }

  return match[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function getStoredUserName(serverConfig = getDefaultServerConfig()) {
  return localStorage.getItem(getUserNameStorageKey(serverConfig));
}

export function storeUserName(userName, serverConfig = getDefaultServerConfig()) {
  localStorage.setItem(getUserNameStorageKey(serverConfig), userName);
}
