function buildObjectKey(object) {
  return `${object.type}${object.id}`;
}

function cloneMember(member) {
  return {
    type: member.type,
    id: member.id,
    role: member.role ?? ""
  };
}

function cloneObject(object) {
  const copy = {
    ...object,
    tags: { ...(object.tags ?? {}) }
  };

  if (object.nodes) {
    copy.nodes = [...object.nodes];
  }

  if (object.members) {
    copy.members = object.members.map(cloneMember);
  }

  return copy;
}

function stripAction(object) {
  const copy = cloneObject(object);
  delete copy.action;
  return copy;
}

function buildMinimalBaseObject(object) {
  const baseObject = {
    type: object.type,
    id: object.id,
    version: object.version,
    tags: {}
  };

  if (object.type === "way") {
    baseObject.nodes = [];
  } else if (object.type === "relation") {
    baseObject.members = [];
  }

  return baseObject;
}

function collectReservedNegativeIds(existingData) {
  const reservedIds = new Set();

  for (const object of existingData) {
    if (object.id < 0) {
      reservedIds.add(buildObjectKey(object));
    }
  }

  return reservedIds;
}

export function renumberCreatedObjects(data, existingData = []) {
  const cloned = data.map(cloneObject);
  const reservedIds = collectReservedNegativeIds(existingData);
  const remap = new Map();
  let nextId = -1;

  while (reservedIds.has(`node${nextId}`) || reservedIds.has(`way${nextId}`) || reservedIds.has(`relation${nextId}`)) {
    nextId -= 1;
  }

  for (const object of cloned) {
    const shouldRemap =
      (object.action === "create" && object.id > 0) ||
      (object.id < 0 && reservedIds.has(buildObjectKey(object)));

    if (!shouldRemap) {
      continue;
    }

    const oldKey = buildObjectKey(object);
    const newId = nextId;
    nextId -= 1;
    remap.set(oldKey, newId);
    reservedIds.add(`${object.type}${newId}`);
    object.id = newId;
  }

  if (remap.size === 0) {
    return cloned;
  }

  for (const object of cloned) {
    if (object.type === "way") {
      object.nodes = (object.nodes ?? []).map((nodeId) => remap.get(`node${nodeId}`) ?? nodeId);
    } else if (object.type === "relation") {
      object.members = (object.members ?? []).map((member) => ({
        ...member,
        id: remap.get(`${member.type}${member.id}`) ?? member.id
      }));
    }
  }

  return cloned;
}

export function prepareImportedFileData(data, existingData = []) {
  const normalizedData = renumberCreatedObjects(data, existingData);
  const editorData = [];
  const baseData = [];

  for (const object of normalizedData) {
    if (object.type === "changeset") {
      editorData.push(stripAction(object));
      continue;
    }

    if (object.action === "create" || object.id <= 0) {
      editorData.push(stripAction(object));
      continue;
    }

    if (object.action === "delete") {
      editorData.push(cloneObject(object));
      baseData.push(buildMinimalBaseObject(object));
      continue;
    }

    if (object.action === "modify") {
      editorData.push(stripAction(object));
      baseData.push(buildMinimalBaseObject(object));
      continue;
    }

    const cleanObject = stripAction(object);
    editorData.push(cleanObject);
    baseData.push(cleanObject);
  }

  return {
    editorData,
    baseData
  };
}
