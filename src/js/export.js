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

export function indexBaseData(data) {
  return new Map(data.map((object) => [buildObjectKey(object), cloneObject(object)]));
}

export function cloneData(data) {
  return data.map(cloneObject);
}

export function isModified(object, baseObject) {
  const objectTags = object.tags ?? {};
  const baseTags = baseObject.tags ?? {};
  const objectTagKeys = Object.keys(objectTags);
  const baseTagKeys = Object.keys(baseTags);

  if (objectTagKeys.length !== baseTagKeys.length) {
    return true;
  }

  for (const key of objectTagKeys) {
    if (objectTags[key] !== baseTags[key]) {
      return true;
    }
  }

  if (object.type === "node") {
    return object.lat !== baseObject.lat || object.lon !== baseObject.lon;
  }

  if (object.type === "way") {
    const objectNodes = object.nodes ?? [];
    const baseNodes = baseObject.nodes ?? [];
    if (objectNodes.length !== baseNodes.length) {
      return true;
    }

    return objectNodes.some((nodeId, index) => nodeId !== baseNodes[index]);
  }

  if (object.type === "relation") {
    const objectMembers = object.members ?? [];
    const baseMembers = baseObject.members ?? [];
    if (objectMembers.length !== baseMembers.length) {
      return true;
    }

    return objectMembers.some((member, index) => {
      const baseMember = baseMembers[index];
      return (
        member.type !== baseMember.type ||
        member.id !== baseMember.id ||
        member.role !== baseMember.role
      );
    });
  }

  return false;
}

function gradeForExport(object) {
  let grade = object.type === "node" ? 0 : object.type === "way" ? 1 : 2;

  if (object.action) {
    if (object.action === "delete") {
      grade = 2 - grade;
    }

    if (object.action === "modify") {
      grade += 10;
    } else if (object.action === "delete") {
      grade += 20;
    }
  }

  return grade;
}

function exportCompare(left, right) {
  const leftGrade = gradeForExport(left);
  const rightGrade = gradeForExport(right);

  if (leftGrade !== rightGrade) {
    return leftGrade - rightGrade;
  }

  return left.id - right.id;
}

function isReservedGeneratedId(createdIds, id) {
  return createdIds.has(`node${id}`) || createdIds.has(`way${id}`) || createdIds.has(`relation${id}`);
}

function takeNextGeneratedId(createdIds, nextGeneratedId) {
  let candidateId = nextGeneratedId;

  while (isReservedGeneratedId(createdIds, candidateId)) {
    candidateId -= 1;
  }

  return candidateId;
}

function rewriteGeneratedReferences(object, generatedIdMap) {
  if (object.type === "way") {
    object.nodes = (object.nodes ?? []).map((nodeId) => generatedIdMap.get(`node${nodeId}`) ?? nodeId);
    return;
  }

  if (object.type === "relation") {
    object.members = (object.members ?? []).map((member) => ({
      ...member,
      id: generatedIdMap.get(`${member.type}${member.id}`) ?? member.id
    }));
  }
}

function orderCreatedRelationsForUpload(sortedData) {
  const createdRelations = sortedData.filter(
    (object) => object.type === "relation" && object.action === "create"
  );

  if (createdRelations.length < 2) {
    return sortedData;
  }

  const relationMap = new Map(
    createdRelations.map((object) => [object.id, object])
  );
  const dependencyCount = new Map(createdRelations.map((object) => [object.id, 0]));
  const dependents = new Map(createdRelations.map((object) => [object.id, []]));

  for (const relation of createdRelations) {
    const childRelationIds = new Set(
      (relation.members ?? [])
        .filter((member) => member.type === "relation" && relationMap.has(member.id))
        .map((member) => member.id)
    );

    dependencyCount.set(relation.id, childRelationIds.size);

    for (const childRelationId of childRelationIds) {
      dependents.get(childRelationId).push(relation.id);
    }
  }

  const queue = createdRelations
    .map((object) => object.id)
    .filter((id) => dependencyCount.get(id) === 0)
    .sort((left, right) => left - right);
  const orderedRelationIds = [];

  while (queue.length > 0) {
    const relationId = queue.shift();
    orderedRelationIds.push(relationId);

    for (const parentRelationId of dependents.get(relationId) ?? []) {
      const nextDependencyCount = dependencyCount.get(parentRelationId) - 1;
      dependencyCount.set(parentRelationId, nextDependencyCount);

      if (nextDependencyCount === 0) {
        queue.push(parentRelationId);
        queue.sort((left, right) => left - right);
      }
    }
  }

  if (orderedRelationIds.length !== createdRelations.length) {
    const remainingRelationIds = createdRelations
      .map((object) => object.id)
      .filter((id) => !orderedRelationIds.includes(id))
      .sort((left, right) => left - right);

    orderedRelationIds.push(...remainingRelationIds);
  }

  const orderedRelationMap = new Map(
    orderedRelationIds.map((id, index) => [id, index])
  );

  return [...sortedData].sort((left, right) => {
    if (left.type === "relation" && left.action === "create" && right.type === "relation" && right.action === "create") {
      return orderedRelationMap.get(left.id) - orderedRelationMap.get(right.id);
    }

    return 0;
  });
}

export function prepareUploadData(userData, baseData) {
  const result = [];
  const createdIds = new Set();
  const baseIndex = baseData instanceof Map ? baseData : indexBaseData(baseData);
  let nextGeneratedId = -1;

  for (const object of userData) {
    if (object.id < 0) {
      const key = buildObjectKey(object);
      if (createdIds.has(key)) {
        throw new Error(`Duplicate ID for ${object.type} ${object.id}`);
      }

      createdIds.add(key);
    }

    if (object.id <= 0 || object.action !== "delete") {
      if (object.type === "way" && (object.nodes?.length ?? 0) < 2) {
        throw new Error(`Way ${object.id} has less than two nodes`);
      }

      if (object.type === "relation" && (object.members?.length ?? 0) === 0) {
        throw new Error(`Relation ${object.id} has no members`);
      }
    }
  }

  const generatedIdMap = new Map();

  for (const object of userData) {
    if (object.type === "changeset" || object.id !== 0) {
      continue;
    }

    const objectKey = buildObjectKey(object);
    if (generatedIdMap.has(objectKey)) {
      throw new Error(`Duplicate ID for ${object.type} 0`);
    }

    const assignedId = takeNextGeneratedId(createdIds, nextGeneratedId);
    generatedIdMap.set(objectKey, assignedId);
    createdIds.add(`${object.type}${assignedId}`);
    nextGeneratedId = assignedId - 1;
  }

  for (const sourceObject of userData) {
    const object = cloneObject(sourceObject);
    rewriteGeneratedReferences(object, generatedIdMap);

    if (object.type === "changeset" && object.id <= 0) {
      result.push(object);
      continue;
    }

    if (object.id <= 0) {
      if (object.id === 0) {
        object.id = generatedIdMap.get(buildObjectKey(object));
      }

      object.version = 1;
      object.action = "create";
      result.push(object);
      continue;
    }

    const key = buildObjectKey(object);
    const baseObject = baseIndex.get(key);
    if (!baseObject) {
      throw new Error(`No base data for ${object.type} ${object.id}`);
    }

    if (object.version === undefined) {
      object.version = baseObject.version;
    }

    if (object.action === "delete") {
      result.push(object);
      continue;
    }

    if (isModified(object, baseObject)) {
      object.action = "modify";
      result.push(object);
      continue;
    }

    result.push(baseObject);
  }

  return orderCreatedRelationsForUpload(result.sort(exportCompare));
}

export function applyDiffResult(data, diffEntries) {
  const cloned = cloneData(data);
  const diffMap = new Map(
    diffEntries.map((entry) => [`${entry.type}${entry.oldId}`, entry])
  );
  const idMap = new Map();

  for (const entry of diffEntries) {
    if (entry.newId !== null && entry.newId !== undefined) {
      idMap.set(`${entry.type}${entry.oldId}`, entry.newId);
    }
  }

  for (const object of cloned) {
    if (object.type === "way") {
      object.nodes = (object.nodes ?? []).map((nodeId) => idMap.get(`node${nodeId}`) ?? nodeId);
    } else if (object.type === "relation") {
      object.members = (object.members ?? []).map((member) => ({
        ...member,
        id: idMap.get(`${member.type}${member.id}`) ?? member.id
      }));
    }
  }

  return cloned
    .filter((object) => object.action !== "delete")
    .map((object) => {
      const diffEntry = diffMap.get(buildObjectKey(object));
      const nextObject = cloneObject(object);

      if (diffEntry?.newId !== null && diffEntry?.newId !== undefined) {
        nextObject.id = diffEntry.newId;
      }

      if (diffEntry?.newVersion !== null && diffEntry?.newVersion !== undefined) {
        nextObject.version = diffEntry.newVersion;
      }

      delete nextObject.action;
      return nextObject;
    });
}

export function buildRefreshReference(data) {
  return data
    .filter((object) => object.type !== "changeset")
    .map((object) => {
      if (object.type === "node") {
        return `n${object.id}`;
      }

      if (object.type === "way") {
        return `w${object.id}!`;
      }

      return `r${object.id}!`;
    })
    .join(",");
}
