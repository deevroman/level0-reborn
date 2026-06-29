import {
  MAP_DOWNLOAD_BASE_RADIUS,
  MAP_DOWNLOAD_BASE_ZOOM,
  MAP_DOWNLOAD_MIN_RADIUS,
  MAP_DOWNLOAD_MAX_RADIUS
} from "./config.js";
import { getDefaultServerConfig } from "./server-config.js";

const OVERPASS_HTTP_HOSTS = [
  "overpass.osm.rambler.ru/cgi",
  "overpass-api.de/api",
  "api.openstreetmap.fr/oapi",
  "overpass.openstreetmap.ie/api"
];

const OVERPASS_HTTPS_HOSTS = [
  "overpass.private.coffee/api",
  "overpass.osm.jp/api",
  "maps.mail.ru/osm/tools/overpass/api"
];

function normalizeCommaSeparatedInput(input) {
  return input.trim().replace(/,+/g, ",").replace(/^,+|,+$/g, "");
}

export function parseMapViewReference(input) {
  const url = normalizeCommaSeparatedInput(input);
  if (url.length === 0) {
    return null;
  }

  let lat = null;
  let lon = null;
  let zoom = MAP_DOWNLOAD_BASE_ZOOM;

  let match = url.match(/([0-9]{1,2})\/(-?[0-9]{1,2}\.[0-9]+)\/(-?[0-9]{1,3}\.[0-9]+)/);
  if (match) {
    return {
      zoom: Number(match[1]),
      lat: Number(match[2]),
      lon: Number(match[3])
    };
  }

  match = url.match(/lat=(-?[0-9]{1,2}\.[0-9]+)/i);
  if (match) {
    lat = Number(match[1]);
  }

  match = url.match(/lon=(-?[0-9]{1,3}\.[0-9]+)/i);
  if (match) {
    lon = Number(match[1]);
  }

  match = url.match(/zoom=([0-9]{1,2})/i);
  if (match) {
    zoom = Number(match[1]);
  }

  if (lat !== null && lon !== null) {
    return { zoom, lat, lon };
  }

  return null;
}

export function removeQueryParameter(urlLike, parameterName) {
  const url = new URL(urlLike.href ?? urlLike.toString());
  url.searchParams.delete(parameterName);
  return `${url.origin}${url.pathname}${url.search}${url.hash}`;
}

function buildApiUrl(osmServer, path) {
  return `${osmServer.apiBase}${path}`;
}

function formatBboxValue(value) {
  return value.toFixed(5);
}

function getMapDownloadRadius(zoom = MAP_DOWNLOAD_BASE_ZOOM) {
  const normalizedZoom = Number.isFinite(zoom) ? zoom : MAP_DOWNLOAD_BASE_ZOOM;
  const radius = MAP_DOWNLOAD_BASE_RADIUS * (2 ** (MAP_DOWNLOAD_BASE_ZOOM - normalizedZoom));
  return Math.max(MAP_DOWNLOAD_MIN_RADIUS, Math.min(MAP_DOWNLOAD_MAX_RADIUS, radius));
}

function buildMapBboxUrl(osmServer, lat, lon, zoom = MAP_DOWNLOAD_BASE_ZOOM) {
  const radius = getMapDownloadRadius(zoom);
  return buildApiUrl(
    osmServer,
    `map?bbox=${formatBboxValue(lon - radius)},${formatBboxValue(lat - radius)},${formatBboxValue(lon + radius)},${formatBboxValue(lat + radius)}`
  );
}

function findOverpassMatch(url) {
  const normalized = url.replace(/^https?:\/\//, "");
  const httpHost = OVERPASS_HTTP_HOSTS.find((host) => normalized.startsWith(`${host}/interpreter?data=`));
  if (httpHost) {
    return `http://${normalized}`;
  }

  const httpsHost = OVERPASS_HTTPS_HOSTS.find((host) => normalized.startsWith(`${host}/interpreter?data=`));
  if (httpsHost) {
    return `https://${normalized}`;
  }

  const devMatch = normalized.match(/^(dev\.overpass-api\.de\/[a-z0-9_]+\/interpreter\?data=.+)$/i);
  if (devMatch) {
    return `http://${devMatch[1]}`;
  }

  return false;
}

function parseObjectList(url, osmServer) {
  if (!/^!?\s*[a-y]+[/\s]*[0-9.]+[!*]?(?:\s*,\s*[a-y]+[/\s]*[0-9.]+[!*]?)*$/i.test(url)) {
    return false;
  }

  const urls = [];
  const objects = url.replace(/^!\s*/, "").split(",");

  for (const object of objects) {
    const match = object.match(/^\s*(n|nd|node|w|wy|way|r|rel|relation|c|changeset)[\s/]*(\d+)(?:\.(\d+))?([!*]?)\s*$/i);
    if (!match) {
      continue;
    }

    const typePrefix = match[1][0].toLowerCase();
    const id = match[2];
    const version = match[3] ? Number(match[3]) : 0;
    const suffix = match[4];

    if (typePrefix === "c") {
      urls.push(buildApiUrl(osmServer, `changeset/${id}/download`));
      continue;
    }

    const type = typePrefix === "n" ? "node" : typePrefix === "w" ? "way" : "relation";
    let apiUrl = buildApiUrl(osmServer, `${type}/${id}`);

    if (version > 0) {
      urls.push(`${apiUrl}/${version}`);
      continue;
    }

    if (suffix === "*") {
      if (type === "node") {
        urls.push(`${apiUrl}/ways`);
      }
      urls.push(`${apiUrl}/relations`);
      continue;
    }

    if (type !== "node" && suffix === "!") {
      urls.push(`${apiUrl}/full`);
      continue;
    }

    urls.push(apiUrl);
  }

  if (urls.length === 0) {
    return false;
  }

  return urls.length === 1 ? urls[0] : urls;
}

export function urlToApiRequests(input, osmServer = getDefaultServerConfig()) {
  const url = normalizeCommaSeparatedInput(input);
  if (url.length === 0) {
    return false;
  }

  let match = url.match(/\/api\/0\.6\/((?:node|way|relation|changeset)\/\d+(?:\/[0-9a-z]+)?)$/i);
  if (match) {
    return buildApiUrl(osmServer, match[1]);
  }

  match = url.match(/\/api\/0\.6\/((nodes|ways|relations)\?\2=\d+.*)$/i);
  if (match) {
    return buildApiUrl(osmServer, match[1]);
  }

  match = url.match(/\/api\/0\.6\/(map\?bbox=.*)$/i);
  if (match) {
    return buildApiUrl(osmServer, match[1]);
  }

  match = url.match(/(?:https?:\/\/[^/]+)?\/(?:browse\/)?((node|way|relation)\/\d+)(?:\/[a-z]+)?(?:#.*)?$/i);
  if (match) {
    return buildApiUrl(osmServer, `${match[1]}${match[2].toLowerCase() === "way" ? "/full" : ""}`);
  }

  match = url.match(/(?:https?:\/\/[^/]+)?\/(?:browse\/)?(changeset\/\d+)(?:#.*)?$/i);
  if (match) {
    return buildApiUrl(osmServer, `${match[1]}/download`);
  }

  const overpassUrl = findOverpassMatch(url);
  if (overpassUrl) {
    return overpassUrl;
  }

  const objectListUrls = parseObjectList(url, osmServer);
  if (objectListUrls) {
    return objectListUrls;
  }

  const mapView = parseMapViewReference(url);
  if (mapView) {
    return buildMapBboxUrl(osmServer, mapView.lat, mapView.lon, mapView.zoom);
  }

  return false;
}
