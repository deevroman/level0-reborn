import { prepareImportedFileData } from "./file-import.js";
import { parseOsmXml } from "./osm-xml.js";
import { getDefaultServerConfig } from "./server-config.js";
import { urlToApiRequests } from "./url.js";

export async function loadOverpassData(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.json();
}

async function loadTextData(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    if (response.status === 410) {
      throw new Error("Deleted object")
    }
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

function buildObjectKey(object) {
  return `${object.type}${object.id}`;
}

function mergeOsmData(parts) {
  const merged = new Map();

  for (const objects of parts) {
    for (const object of objects) {
      const key = buildObjectKey(object);
      const existing = merged.get(key);
      const existingVersion = existing?.version ?? 0;
      const objectVersion = object.version ?? 0;

      if (!existing || objectVersion >= existingVersion) {
        merged.set(key, object);
      }
    }
  }

  return [...merged.values()];
}

function findIncompleteRelationIds(data) {
  const knownObjectKeys = new Set(
    data
      .filter((object) => object.type !== "changeset")
      .map((object) => buildObjectKey(object))
  );

  return data
    .filter((object) => object.type === "relation" && object.id > 0)
    .filter((relation) =>
      (relation.members ?? []).some((member) => !knownObjectKeys.has(`${member.type}${member.id}`))
    )
    .map((relation) => relation.id);
}

export async function loadIncompleteRelationData(data, osmServer, fetchImpl = fetch) {
  let mergedData = mergeOsmData([data]);
  const extraRequests = [];
  const expandedRelationIds = new Set();
  const initialKeys = new Set(data.map((object) => buildObjectKey(object)));

  while (true) {
    const incompleteRelationIds = findIncompleteRelationIds(mergedData)
      .filter((relationId) => !expandedRelationIds.has(relationId));

    if (incompleteRelationIds.length === 0) {
      return {
        data: mergedData,
        addedData: mergedData.filter((object) => !initialKeys.has(buildObjectKey(object))),
        requests: extraRequests
      };
    }

    const relationRequests = incompleteRelationIds.map((relationId) => `${osmServer.apiBase}relation/${relationId}/full`);
    const parts = await Promise.all(
      relationRequests.map(async (url) => parseOsmXml(await loadTextData(url, fetchImpl)))
    );

    for (const relationId of incompleteRelationIds) {
      expandedRelationIds.add(relationId);
    }

    extraRequests.push(...relationRequests);
    mergedData = mergeOsmData([mergedData, ...parts]);
  }
}

export async function loadSupportedUrl(input, osmServer = getDefaultServerConfig(), fetchImpl = fetch) {
  const requests = urlToApiRequests(input, osmServer);

  if (requests) {
    const requestList = Array.isArray(requests) ? requests : [requests];
    const parts = await Promise.all(
      requestList.map(async (url) => {
        try {
          return parseOsmXml(await loadTextData(url, fetchImpl));
        } catch (e) {
          if (e.message === "Deleted object") { // todo
            return null;
          }
          throw e
        }
      })
    );
    const data = mergeOsmData(parts.filter(i => i !== null));

    return {
      data,
      raw: JSON.stringify(data, null, 2),
      requests: requestList
    };
  }

  if (/^https?:\/\//.test(input)) {
    const response = await loadOverpassData(input, fetchImpl);
    const data = response.elements ?? response;

    return {
      data,
      raw: JSON.stringify(data, null, 2),
      requests: [input]
    };
  }

  throw new Error("Could not parse the URL.");
}

export async function loadSupportedFile(file, existingData = []) {
  const xml = await file.text();
  const data = parseOsmXml(xml);

  if (data.length === 0) {
    throw new Error(`No OSM objects found in file ${file.name}.`);
  }

  const prepared = prepareImportedFileData(data, existingData);

  return {
    data,
    editorData: prepared.editorData,
    baseData: prepared.baseData,
    raw: xml,
    sourceLabel: file.name
  };
}
