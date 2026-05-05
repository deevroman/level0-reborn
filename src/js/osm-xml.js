function decodeXmlEntities(value) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseAttributes(source) {
  const attributes = {};

  for (const match of source.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attributes[match[1]] = decodeXmlEntities(match[2]);
  }

  return attributes;
}

function pushLatestVersion(result, object) {
  const existingIndex = result.findIndex((item) => item.type === object.type && item.id === object.id);
  if (existingIndex === -1) {
    result.push(object);
    return;
  }

  const existingVersion = result[existingIndex].version ?? 0;
  const objectVersion = object.version ?? 0;
  if (objectVersion >= existingVersion) {
    result.splice(existingIndex, 1, object);
  }
}

export function parseOsmXml(xml) {
  const tokenPattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<([^!?/\s>]+)([^>]*?)(\/?)>|<\/([^>]+)>/g;
  const result = [];
  let mode = null;
  let current = null;

  for (const match of xml.matchAll(tokenPattern)) {
    const openingTag = match[1];
    const attributesSource = match[2] ?? "";
    const selfClosing = match[3] === "/";
    const closingTag = match[4];

    if (openingTag) {
      const tagName = openingTag.toLowerCase();
      const attributes = parseAttributes(attributesSource);

      if (tagName === "modify" || tagName === "create" || tagName === "delete") {
        mode = tagName;
      } else if (tagName === "node" || tagName === "way" || tagName === "relation" || tagName === "changeset") {
        current = {
          type: tagName,
          id: attributes.id ? Number(attributes.id) : 0,
          tags: {}
        };

        const action = mode ?? attributes.action;
        if (action) {
          current.action = action;
        }
        if (attributes.version) {
          current.version = Number(attributes.version);
        }
        if (attributes.user) {
          current.user = attributes.user;
        }
        if (attributes.uid) {
          current.uid = Number(attributes.uid);
        }
        if (attributes.changeset) {
          current.changeset = Number(attributes.changeset);
        }
        if (attributes.timestamp) {
          current.timestamp = attributes.timestamp;
        }
        if (attributes.visible === "false") {
          current.deleted = true;
        }

        if (tagName === "node") {
          if (attributes.lat !== undefined && attributes.lon !== undefined) {
            current.lat = Number(attributes.lat);
            current.lon = Number(attributes.lon);
          }
        } else if (tagName === "way") {
          current.nodes = [];
        } else if (tagName === "relation") {
          current.members = [];
        }
      } else if (tagName === "tag" && current) {
        const key = attributes.k?.trim();
        const value = attributes.v?.trim();
        if (key && value) {
          current.tags[key] = value;
        }
      } else if (tagName === "nd" && current?.type === "way" && attributes.ref) {
        current.nodes.push(Number(attributes.ref));
      } else if (tagName === "member" && current?.type === "relation" && attributes.type && attributes.ref) {
        current.members.push({
          type: attributes.type,
          id: Number(attributes.ref),
          role: attributes.role ?? ""
        });
      }

      if (selfClosing) {
        if (tagName === "modify" || tagName === "create" || tagName === "delete") {
          mode = null;
        } else if (current && tagName === current.type) {
          pushLatestVersion(result, current);
          current = null;
        }
      }

      continue;
    }

    if (!closingTag) {
      continue;
    }

    const tagName = closingTag.toLowerCase();
    if (tagName === mode) {
      mode = null;
    } else if (current && tagName === current.type) {
      pushLatestVersion(result, current);
      current = null;
    }
  }

  return result;
}
