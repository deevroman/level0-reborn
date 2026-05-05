import { GENERATOR } from "./config.js";

function buildValidationEntry(isError, line, message) {
  return [isError, line, message];
}

function validateEntity(entity, line, validation) {
  const isNew = Number(entity.id) <= 0;
  const isDeleted = entity.action === "delete";

  if (!(isNew || !isDeleted)) {
    return;
  }

  if (entity.type === "way" && entity.nodes.length < 2) {
    validation.push(buildValidationEntry(true, line, `Way ${entity.id} has less than two nodes`));
  } else if (entity.type === "relation" && entity.members.length === 0) {
    validation.push(buildValidationEntry(true, line, `Relation ${entity.id} has no members`));
  }
}

function createEntity(match, line, validation, foundChangeset) {
  const entity = {
    type: match[3],
    id: match[4]?.length > 0 ? Number(match[4]) : 0,
    tags: {}
  };

  if (match[1] === "!") {
    validation.push(buildValidationEntry(true, line, `Please resolve conflict of ${entity.type} ${entity.id}`));
  }

  if (match[2] === "-") {
    if (entity.id > 0) {
      entity.action = "delete";
    } else {
      validation.push(buildValidationEntry(true, line, "Deleting an unsaved object"));
    }
  }

  if (entity.type === "changeset" && entity.id <= 0) {
    if (foundChangeset.value) {
      validation.push(buildValidationEntry(true, line, "There can be only one changeset metadata"));
    } else {
      foundChangeset.value = true;
    }
  }

  if (match[5]?.length > 0) {
    entity.version = Number(match[5]);
  }

  if (match[6]?.length > 0 && match[7]?.length > 0) {
    if (entity.type === "node") {
      entity.lat = Number(match[6]);
      entity.lon = Number(match[7]);
    } else {
      validation.push(buildValidationEntry(false, line, `Coordinates specified for ${entity.type} ${entity.id}`));
    }
  } else if (entity.type === "node" && match[2] !== "-") {
    validation.push(buildValidationEntry(true, line, "Node without coordinates"));
  }

  if (entity.type === "way") {
    entity.nodes = [];
  } else if (entity.type === "relation") {
    entity.members = [];
  }

  return entity;
}

function parseMemberLine(line, entity, lineNumber, validation) {
  const match = line.match(/^\s*(nd|wy|rel)\s+(-?\d+)(?:\s+(.+?))?\s*$/);
  if (!match) {
    return false;
  }

  if (entity.type === "node") {
    validation.push(buildValidationEntry(true, lineNumber, "A node cannot have member objects"));
    return true;
  }

  if (entity.type === "way") {
    if (match[1] === "nd") {
      entity.nodes.push(Number(match[2]));
      if (match[3]?.length > 0) {
        validation.push(buildValidationEntry(false, lineNumber, "Role name specified for a way node"));
      }
    } else {
      validation.push(buildValidationEntry(true, lineNumber, "Ways cannot have members besides nodes"));
    }

    return true;
  }

  entity.members.push({
    type: match[1] === "nd" ? "node" : match[1] === "wy" ? "way" : "relation",
    id: Number(match[2]),
    role: match[3] ?? ""
  });

  return true;
}

function parseTagLine(line, entity, lineNumber, validation) {
  const match = line.match(/^\s*([^=]*?(?:\\=[^=]*?)*)\s*=\s*(.+?)\s*$/);
  if (!match) {
    validation.push(buildValidationEntry(false, lineNumber, `Unknown content while parsing ${entity.type} ${entity.id}`));
    return;
  }

  let equalsIndex = 1;
  while (
    equalsIndex < line.length &&
    (line.slice(equalsIndex, equalsIndex + 1) !== "=" || line.slice(equalsIndex - 1, equalsIndex) === "\\")
  ) {
    equalsIndex += 1;
  }

  if (equalsIndex >= line.length) {
    validation.push(buildValidationEntry(false, lineNumber, `Unknown content while parsing ${entity.type} ${entity.id}`));
    return;
  }

  const key = line.slice(0, equalsIndex).trim().replace("\\=", "=");
  const value = line.slice(equalsIndex + 1).trim();

  if (Object.hasOwn(entity.tags, key)) {
    validation.push(buildValidationEntry(true, lineNumber, "Duplicated tag"));
    return;
  }

  entity.tags[key] = value;
}

export function parseLevel0L(level0lString) {
  const lines = level0lString.split("\n");
  const data = [];
  const validation = [];
  const foundChangeset = { value: false };
  let currentEntity = null;
  let lineNumber = 0;

  for (lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const rawLine = lines[lineNumber];
    const line = rawLine.trim();

    if (line.length === 0 || line[0] === "#") {
      continue;
    }

    const headerMatch = line.match(
      /^(!)?(-)?(node|way|relation|changeset)(?:\s+(-?[0-9]+)(?:\.([0-9]+))?)?(?:\s*:\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?))?\s*(?:#.*)?$/
    );

    if (headerMatch) {
      if (currentEntity) {
        validateEntity(currentEntity, lineNumber - 1, validation);
        data.push(currentEntity);
      }

      currentEntity = createEntity(headerMatch, lineNumber, validation, foundChangeset);
      continue;
    }

    if (!currentEntity) {
      validation.push(buildValidationEntry(false, lineNumber, "Unknown and unparsed content found"));
      continue;
    }

    if (parseMemberLine(rawLine, currentEntity, lineNumber, validation)) {
      continue;
    }

    parseTagLine(rawLine, currentEntity, lineNumber, validation);
  }

  if (currentEntity) {
    validateEntity(currentEntity, lineNumber, validation);
    data.push(currentEntity);
  }

  return { data, validation };
}

export function level0LToOSMChange(level0lString) {
  return parseLevel0L(level0lString).data;
}

function hasTags(object) {
  return Object.keys(object.tags ?? {}).length > 0;
}

function isBareNode(object) {
  return object.type === "node" && !hasTags(object) && !object.conflict;
}

function orderForLevel0L(data) {
  const regularObjects = [];
  const bareNodes = [];

  for (const object of data) {
    if (isBareNode(object)) {
      bareNodes.push(object);
    } else {
      regularObjects.push(object);
    }
  }

  return [...regularObjects, ...bareNodes];
}

function cloneMember(member) {
  return {
    type: member.type,
    id: member.id,
    role: member.role ?? ""
  };
}

function cloneObject(object) {
  const cloned = {
    ...object,
    tags: { ...(object.tags ?? {}) }
  };

  if (object.nodes) {
    cloned.nodes = [...object.nodes];
  }

  if (object.members) {
    cloned.members = object.members.map(cloneMember);
  }

  if (object.conflict) {
    cloned.conflict = cloneObject(object.conflict);
  }

  return cloned;
}

export function dataToLevel0L(data) {
  const lines = [];
  const orderedData = orderForLevel0L(data);
  let previousNeedsBlankLine = false;

  for (let index = 0; index < orderedData.length; index += 1) {
    const object = orderedData[index];
    let header = "";

    if (index > 0 && (previousNeedsBlankLine || object.type !== "node")) {
      lines.push("");
    }

    if (object.action === "delete") {
      header += "-";
    }

    header += object.type;

    if (object.id !== 0 && object.id !== undefined) {
      header += ` ${object.id}`;
      if (object.version !== undefined) {
        header += `.${object.version}`;
      }
    }

    if (object.type === "node" && object.lat !== undefined && object.lon !== undefined) {
      header += `: ${object.lat}, ${object.lon}`;
    }

    lines.push(header);

    for (const [key, value] of Object.entries(object.tags ?? {})) {
      lines.push(`  ${String(key).replaceAll("=", "\\=")} = ${value}`);
    }

    if (object.type === "way") {
      for (const nodeId of object.nodes ?? []) {
        lines.push(`  nd ${nodeId}`);
      }
    } else if (object.type === "relation") {
      for (const member of object.members ?? []) {
        const memberType = member.type === "node" ? "nd" : member.type === "way" ? "wy" : "rel";
        lines.push(`  ${memberType} ${member.id}${member.role ? ` ${member.role}` : ""}`);
      }
    }

    previousNeedsBlankLine = object.type !== "node" || hasTags(object) || Boolean(object.conflict);
  }

  return lines.join("\n");
}

export function renumberDataForSandbox(data) {
  const clonedData = data.map(cloneObject);
  const reservedNegativeIds = new Set();
  const idMap = new Map();
  let nextId = -1;

  for (const object of clonedData) {
    if ((object.type === "node" || object.type === "way" || object.type === "relation") && object.id < 0) {
      reservedNegativeIds.add(`${object.type}${object.id}`);
    }
  }

  while (
    reservedNegativeIds.has(`node${nextId}`) ||
    reservedNegativeIds.has(`way${nextId}`) ||
    reservedNegativeIds.has(`relation${nextId}`)
  ) {
    nextId -= 1;
  }

  for (const object of clonedData) {
    if (object.type !== "node" && object.type !== "way" && object.type !== "relation") {
      continue;
    }

    delete object.version;
    delete object.action;

    if (object.id <= 0) {
      continue;
    }

    const newId = nextId;
    nextId -= 1;
    idMap.set(`${object.type}${object.id}`, newId);
    object.id = newId;
  }

  for (const object of clonedData) {
    if (object.type === "way") {
      object.nodes = (object.nodes ?? []).map((nodeId) => idMap.get(`node${nodeId}`) ?? nodeId);
    } else if (object.type === "relation") {
      object.members = (object.members ?? []).map((member) => ({
        ...member,
        id: idMap.get(`${member.type}${member.id}`) ?? member.id
      }));
    }
  }

  return clonedData;
}

export function mergeLoadedDataIntoEditorText(existingText, incomingData) {
  const { data: existingData } = parseLevel0L(existingText);
  const incomingKeys = new Set(
    incomingData.map((object) => `${object.type}${object.id}`)
  );

  return dataToLevel0L([
    ...incomingData,
    ...existingData.filter((object) => !incomingKeys.has(`${object.type}${object.id}`))
  ]);
}

export function escapeXml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#039;";
      default:
        return char;
    }
  });
}

export function createOsc(data, changeset = false) {
  const now = new Date().toISOString();
  let osc = `<?xml version="1.0" encoding="UTF-8"?>\n<osmChange version="0.6" generator="${GENERATOR}">\n`;
  let lastMode = "";

  for (const object of data) {
    if (!object.action || object.type === "changeset") {
      continue;
    }

    if (object.action !== lastMode) {
      if (lastMode) {
        osc += `  </${lastMode}>\n`;
      }

      osc += `  <${object.action}>\n`;
      lastMode = object.action;
    }

    osc += `    <${object.type} id='${object.id}' version='${object.version}'`;
    if (object.type === "node" && object.lat !== undefined && object.lon !== undefined) {
      osc += ` lat='${object.lat}' lon='${object.lon}'`;
    }
    if (changeset) {
      osc += ` changeset='${changeset}'`;
    }
    osc += ` timestamp='${object.timestamp ?? now}'>\n`;

    if (object.type === "way") {
      for (const nodeId of object.nodes) {
        osc += `      <nd ref='${nodeId}' />\n`;
      }
    } else if (object.type === "relation") {
      for (const member of object.members) {
        osc += `      <member type='${member.type}' ref='${member.id}' role='${escapeXml(member.role)}' />\n`;
      }
    }

    for (const [key, value] of Object.entries(object.tags)) {
      osc += `      <tag k='${escapeXml(key)}' v='${escapeXml(value)}' />\n`;
    }

    osc += `    </${object.type}>\n`;
  }

  if (lastMode) {
    osc += `  </${lastMode}>\n`;
  }

  return `${osc}</osmChange>`;
}

export function createOsm(data) {
  const now = new Date().toISOString();
  let osm = `<?xml version='1.0' encoding='UTF-8'?>\n<osm version='0.6' upload='true' generator='${GENERATOR}'>\n`;

  for (const object of data) {
    if (object.type === "changeset") {
      continue;
    }

    osm += `  <${object.type} id='${object.id}' version='${object.version}'`;
    if (object.type === "node" && object.lat !== undefined && object.lon !== undefined) {
      osm += ` lat='${object.lat}' lon='${object.lon}'`;
    }

    for (const key of ["user", "uid", "changeset", "action"]) {
      if (object[key] !== undefined) {
        osm += ` ${key}='${escapeXml(String(object[key]))}'`;
      }
    }

    osm += ` timestamp='${object.timestamp ?? now}'>\n`;

    if (object.type === "way") {
      for (const nodeId of object.nodes) {
        osm += `    <nd ref='${nodeId}' />\n`;
      }
    } else if (object.type === "relation") {
      for (const member of object.members) {
        osm += `    <member type='${member.type}' ref='${member.id}' role='${escapeXml(member.role)}' />\n`;
      }
    }

    for (const [key, value] of Object.entries(object.tags)) {
      osm += `    <tag k='${escapeXml(key)}' v='${escapeXml(value)}' />\n`;
    }

    osm += `  </${object.type}>\n`;
  }

  return `${osm}</osm>`;
}
