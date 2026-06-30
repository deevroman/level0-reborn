const KM_PER_DEGREE_LAT = 111.32;
const DEFAULT_MAX_SPLITS = 4;
const DEFAULT_MIN_SPLIT_SIZE_KM = 10;

function logSplit(message, details) {
  if (details === undefined) {
    console.log(`[upload-split] ${message}`);
    return;
  }

  console.log(`[upload-split] ${message}`, details);
}

function buildObjectKey(object) {
  return `${object.type}${object.id}`;
}

function indexObjects(data) {
  return new Map(data.map((object) => [buildObjectKey(object), object]));
}

function cloneObject(object) {
  return {
    ...object,
    tags: { ...(object.tags ?? {}) },
    nodes: object.nodes ? [...object.nodes] : undefined,
    members: object.members ? object.members.map((member) => ({ ...member })) : undefined
  };
}

function pointBbox(lat, lon) {
  return {
    minLat: lat,
    minLon: lon,
    maxLat: lat,
    maxLon: lon
  };
}

function unionBbox(left, right) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return {
    minLat: Math.min(left.minLat, right.minLat),
    minLon: Math.min(left.minLon, right.minLon),
    maxLat: Math.max(left.maxLat, right.maxLat),
    maxLon: Math.max(left.maxLon, right.maxLon)
  };
}

function bboxWidthKm(bbox) {
  const latitudeFactor = Math.abs(Math.cos(((bbox.minLat + bbox.maxLat) / 2) * Math.PI / 180));
  return (bbox.maxLon - bbox.minLon) * KM_PER_DEGREE_LAT * latitudeFactor;
}

function bboxHeightKm(bbox) {
  return (bbox.maxLat - bbox.minLat) * KM_PER_DEGREE_LAT;
}

function bboxAreaKm2(bbox) {
  return bboxWidthKm(bbox) * bboxHeightKm(bbox);
}

function bboxCenter(bbox) {
  return {
    lat: (bbox.minLat + bbox.maxLat) / 2,
    lon: (bbox.minLon + bbox.maxLon) / 2
  };
}

function buildMemberKey(member) {
  return `${member.type}${member.id}`;
}

function resolveObjectBbox(key, currentIndex, baseIndex, cache, visiting) {
  if (cache.has(key)) {
    return cache.get(key);
  }

  if (visiting.has(key)) {
    return null;
  }

  visiting.add(key);

  const currentObject = currentIndex.get(key);
  const baseObject = baseIndex.get(key);
  const type = currentObject?.type ?? baseObject?.type;

  let bbox = null;

  if (type === "node") {
    if (currentObject?.lat !== undefined && currentObject?.lon !== undefined) {
      bbox = pointBbox(currentObject.lat, currentObject.lon);
    }

    if (baseObject?.lat !== undefined && baseObject?.lon !== undefined) {
      bbox = unionBbox(bbox, pointBbox(baseObject.lat, baseObject.lon));
    }
  } else if (type === "way") {
    const nodeIds = new Set([...(currentObject?.nodes ?? []), ...(baseObject?.nodes ?? [])]);
    for (const nodeId of nodeIds) {
      const nodeBbox = resolveObjectBbox(`node${nodeId}`, currentIndex, baseIndex, cache, visiting);
      bbox = unionBbox(bbox, nodeBbox);
    }
  } else if (type === "relation") {
    const members = new Map();

    for (const member of baseObject?.members ?? []) {
      members.set(buildMemberKey(member), member);
    }

    for (const member of currentObject?.members ?? []) {
      members.set(buildMemberKey(member), member);
    }

    for (const member of members.values()) {
      const memberBbox = resolveObjectBbox(buildMemberKey(member), currentIndex, baseIndex, cache, visiting);
      bbox = unionBbox(bbox, memberBbox);
    }
  }

  visiting.delete(key);
  cache.set(key, bbox);
  return bbox;
}

function collectSpatialItems(uploadData, baseData) {
  const currentIndex = indexObjects(uploadData);
  const baseIndex = indexObjects(baseData);
  const cache = new Map();
  const items = [];

  logSplit("collecting bboxes", {
    uploadObjects: uploadData.length,
    baseObjects: baseData.length
  });

  for (const object of uploadData) {
    if (object.type === "changeset") {
      continue;
    }

    const bbox = resolveObjectBbox(buildObjectKey(object), currentIndex, baseIndex, cache, new Set());
    if (!bbox) {
      logSplit("cannot resolve bbox for object, disabling split", buildObjectKey(object));
      return null;
    }

    items.push({
      object,
      bbox,
      center: bboxCenter(bbox)
    });
  }

  return items;
}

function buildGroupBbox(items) {
  let bbox = null;

  for (const item of items) {
    bbox = unionBbox(bbox, item.bbox);
  }

  return bbox;
}

function partitionItems(items, divider, axis) {
  const left = [];
  const right = [];

  for (const item of items) {
    if (item.center[axis] <= divider) {
      left.push(item);
    } else {
      right.push(item);
    }
  }

  return [left, right];
}

function bestSplitForAxis(items, axis) {
  const sortedCenters = [...new Set(items.map((item) => item.center[axis]))].sort((left, right) => left - right);
  let best = null;

  logSplit(`searching ${axis} split`, {
    items: items.length,
    candidates: sortedCenters.length
  });

  for (let index = 0; index < sortedCenters.length - 1; index += 1) {
    const divider = (sortedCenters[index] + sortedCenters[index + 1]) / 2;
    const [left, right] = partitionItems(items, divider, axis);

    if (left.length === 0 || right.length === 0) {
      logSplit(`skipped empty ${axis} half`, {
        divider,
        left: left.length,
        right: right.length
      });
      continue;
    }

    const leftBbox = buildGroupBbox(left);
    const rightBbox = buildGroupBbox(right);
    const score = bboxAreaKm2(leftBbox) + bboxAreaKm2(rightBbox);

    if (
      !best ||
      score < best.score ||
      (score === best.score && Math.max(left.length, right.length) < Math.max(best.left.length, best.right.length))
    ) {
      best = {
        axis,
        divider,
        left,
        right,
        score
      };
      logSplit(`new best ${axis} split`, {
        divider,
        left: left.length,
        right: right.length,
        score
      });
    }
  }

  return best;
}

function findBestSplit(items) {
  const vertical = bestSplitForAxis(items, "lon");
  const horizontal = bestSplitForAxis(items, "lat");

  if (!vertical) {
    return horizontal;
  }

  if (!horizontal) {
    return vertical;
  }

  if (horizontal.score < vertical.score) {
    return horizontal;
  }

  return vertical;
}

function splitItems(items, remainingGroups, minSplitSizeKm) {
  const bbox = buildGroupBbox(items);
  if (!bbox || remainingGroups <= 1 || items.length <= 1) {
    logSplit("stop splitting", {
      items: items.length,
      remainingGroups,
      reason: !bbox ? "missing bbox" : remainingGroups <= 1 ? "group limit reached" : "single item"
    });
    return [items];
  }

  if (bboxWidthKm(bbox) < minSplitSizeKm && bboxHeightKm(bbox) < minSplitSizeKm) {
    logSplit("stop splitting", {
      items: items.length,
      remainingGroups,
      reason: "bbox below minimum size",
      widthKm: bboxWidthKm(bbox),
      heightKm: bboxHeightKm(bbox)
    });
    return [items];
  }

  const bestSplit = findBestSplit(items);
  if (!bestSplit || bestSplit.score > bboxAreaKm2(bbox)) {
    logSplit("stop splitting", {
      items: items.length,
      remainingGroups,
      reason: "no improving split"
    });
    return [items];
  }

  if (bestSplit.left.length === 0 || bestSplit.right.length === 0) {
    logSplit("refused empty split", {
      items: items.length,
      remainingGroups,
      left: bestSplit.left.length,
      right: bestSplit.right.length
    });
    return [items];
  }

  logSplit("split accepted", {
    items: items.length,
    remainingGroups,
    axis: bestSplit.axis,
    divider: bestSplit.divider,
    left: bestSplit.left.length,
    right: bestSplit.right.length
  });

  let bestGroups = [items];
  let bestScore = bboxAreaKm2(bbox);

  for (let leftBudget = 1; leftBudget < remainingGroups; leftBudget += 1) {
    const rightBudget = remainingGroups - leftBudget;
    const leftGroups = splitItems(bestSplit.left, leftBudget, minSplitSizeKm);
    const rightGroups = splitItems(bestSplit.right, rightBudget, minSplitSizeKm);
    const groups = [...leftGroups, ...rightGroups];

    const score = groups.reduce((sum, group) => {
      const groupBbox = buildGroupBbox(group);
      return sum + (groupBbox ? bboxAreaKm2(groupBbox) : 0);
    }, 0);

    if (score < bestScore || (score === bestScore && groups.length > bestGroups.length)) {
      bestScore = score;
      bestGroups = groups;
    }
  }

  return bestGroups;
}

function buildGroupBboxFromObjects(group, bboxMap) {
  let bbox = null;

  for (const object of group) {
    if (object.type === "changeset") {
      continue;
    }

    const objectBbox = bboxMap.get(buildObjectKey(object));
    bbox = unionBbox(bbox, objectBbox);
  }

  return bbox;
}

export function collectUploadObjectBboxes(uploadData, baseData = []) {
  const items = collectSpatialItems(uploadData, baseData);
  if (!items) {
    return null;
  }

  const bboxes = new Map();
  for (const item of items) {
    bboxes.set(buildObjectKey(item.object), item.bbox);
  }

  return bboxes;
}

export function splitUploadDataIntoGroups(uploadData, baseData = [], options = {}) {
  const maxGroups = Math.max(1, options.maxGroups ?? DEFAULT_MAX_SPLITS);
  const minSplitSizeKm = options.minSplitSizeKm ?? DEFAULT_MIN_SPLIT_SIZE_KM;
  const items = collectSpatialItems(uploadData, baseData);

  if (!items || items.length === 0) {
    return [uploadData.map(cloneObject)];
  }

  const splitGroups = splitItems(items, maxGroups, minSplitSizeKm).map((group) =>
    group.map((item) => item.object)
  );
  const changesetObjects = uploadData.filter((object) => object.type === "changeset");

  if (changesetObjects.length === 0) {
    return splitGroups;
  }

  return splitGroups.map((group) => [...changesetObjects, ...group]);
}

export function buildUploadSplitPlan(uploadData, baseData = [], options = {}) {
  const bboxMap = collectUploadObjectBboxes(uploadData, baseData);
  const groups = splitUploadDataIntoGroups(uploadData, baseData, options);
  const groupSummaries = groups.map((group) => {
    const groupBbox = bboxMap ? buildGroupBboxFromObjects(group, bboxMap) : null;
    return {
      objects: group,
      objectCount: group.filter((object) => object.type !== "changeset").length,
      bbox: groupBbox
    };
  });

  logSplit("prepared split plan", {
    groups: groupSummaries.length,
    objectCounts: groupSummaries.map((group) => group.objectCount)
  });

  return {
    groups,
    groupSummaries
  };
}
