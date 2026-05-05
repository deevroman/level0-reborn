import { getStoredAccessToken } from "./auth.js";
import { GENERATOR } from "./config.js";
import { createOsc, escapeXml } from "./level0l.js";
import { getDefaultServerConfig } from "./server-config.js";

function readResponseText(response) {
  return response.text();
}

function getChangesetTags(data, comment) {
  const changesetObject = data.find((object) => object.type === "changeset" && object.id <= 0);
  const tags = { ...(changesetObject?.tags ?? {}) };

  if (comment.trim().length > 0) {
    tags.comment = comment.trim();
  }

  tags.created_by = GENERATOR;
  return tags;
}

export function createChangesetXml(data, comment) {
  const tags = getChangesetTags(data, comment);
  let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<osm>\n  <changeset>\n";

  for (const [key, value] of Object.entries(tags)) {
    if (String(value).trim() !== "") {
      xml += `    <tag k='${escapeXml(key)}' v='${escapeXml(String(value))}' />\n`;
    }
  }

  xml += "  </changeset>\n</osm>";
  return xml;
}

export function parseDiffResult(xml) {
  const entries = [];

  for (const match of xml.matchAll(/<(node|way|relation)\b([^>]*)\/>/g)) {
    const type = match[1];
    const attributes = match[2];
    const oldIdMatch = attributes.match(/\bold_id="(-?\d+)"/);
    if (!oldIdMatch) {
      continue;
    }

    const newIdMatch = attributes.match(/\bnew_id="(-?\d+)"/);
    const newVersionMatch = attributes.match(/\bnew_version="(\d+)"/);

    entries.push({
      type,
      oldId: Number(oldIdMatch[1]),
      newId: newIdMatch ? Number(newIdMatch[1]) : null,
      newVersion: newVersionMatch ? Number(newVersionMatch[1]) : null
    });
  }

  return entries;
}

async function ensureSuccessfulResponse(response, stage) {
  if (response.ok) {
    return response;
  }

  const body = await readResponseText(response);
  throw new Error(`OSM upload failed at ${stage}: ${response.status} ${body}`);
}

export async function uploadChanges(
  data,
  comment,
  osmServer = getDefaultServerConfig(),
  fetchImpl = fetch,
  accessToken = null
) {
  const token = accessToken ?? getStoredAccessToken(osmServer);
  if (!token) {
    throw new Error("OAuth token was lost, please log in again.");
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/xml"
  };

  const createResponse = await fetchImpl(`${osmServer.apiBase}changeset/create`, {
    method: "PUT",
    headers,
    body: createChangesetXml(data, comment)
  });
  await ensureSuccessfulResponse(createResponse, "changeset/create");
  const changesetId = (await createResponse.text()).trim();

  if (!/^\d+$/.test(changesetId)) {
    throw new Error("Could not acquire changeset id for a new changeset.");
  }

  const uploadResponse = await fetchImpl(`${osmServer.apiBase}changeset/${changesetId}/upload`, {
    method: "POST",
    headers,
    body: createOsc(data, changesetId)
  });
  await ensureSuccessfulResponse(uploadResponse, "changeset/upload");
  const diffResultXml = await uploadResponse.text();

  const closeResponse = await fetchImpl(`${osmServer.apiBase}changeset/${changesetId}/close`, {
    method: "PUT",
    headers
  });
  await ensureSuccessfulResponse(closeResponse, "changeset/close");

  return {
    changesetId: Number(changesetId),
    diffResult: parseDiffResult(diffResultXml)
  };
}
