export const HEADER_RE = /^!?-?(node|way|relation)(?:\s+(-?\d+))?(?:\.\d+)?(?:\s*:\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?))?\s*(?:#.*)?$/;
export const NODE_SET_RE = /^(!?-?node(?:\s+(-?\d+))?\s*)(\s*:\s*)?(-?\d{1,2}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?)?(\s*#.*)?\s*$/;
export const ND_RE = /^\s*nd\s+(-?\d+)\s*$/;

export function splitLines(text) {
  return text.split("\n");
}

export function getSelectionRow(text, selectionStart) {
  return text.slice(0, selectionStart).split("\n").length - 1;
}

export function findNodeCoords(lines, id) {
  const nodeLineRe = /^!?-?node\s+(-?\d+)(?:\.\d+)?\s*:\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*(?:#.*)?$/;

  for (const line of lines) {
    const match = nodeLineRe.exec(line);
    if (match && match[1] === String(id)) {
      return [Number(match[2]), Number(match[3])];
    }
  }

  return false;
}

export function findHeaderRow(lines, row) {
  let headerRow = row;
  while (headerRow >= 0 && !HEADER_RE.test(lines[headerRow])) {
    headerRow -= 1;
  }
  return headerRow;
}

export function parseHeader(line) {
  return HEADER_RE.exec(line);
}

export function collectWaySegments(lines, headerRow, highlight = false) {
  let wayRow = headerRow + 1;
  let nodes = [];
  const segments = [];

  while (wayRow < lines.length && !HEADER_RE.test(lines[wayRow])) {
    const match = ND_RE.exec(lines[wayRow]);
    wayRow += 1;

    if (!match) {
      continue;
    }

    const coords = findNodeCoords(lines, match[1]);
    if (coords) {
      nodes.push(coords);
      continue;
    }

    if (nodes.length >= 2) {
      segments.push({
        coords: nodes,
        color: highlight ? "#f30" : "#03f"
      });
    }
    nodes = [];
  }

  if (nodes.length >= 2) {
    segments.push({
      coords: nodes,
      color: highlight ? "#f30" : "#03f"
    });
  }

  return segments;
}

export function collectVisibleMapGeometry(text) {
  const lines = splitLines(text);
  const points = [];
  const segments = [];

  function hasNodeTags(headerRow) {
    let row = headerRow + 1;
    while (row < lines.length && !HEADER_RE.test(lines[row])) {
      const trimmed = lines[row].trim();
      if (trimmed.length > 0 && trimmed[0] !== "#") {
        return true;
      }
      row += 1;
    }
    return false;
  }

  for (let row = 0; row < lines.length; row += 1) {
    const header = parseHeader(lines[row]);
    if (!header) {
      continue;
    }

    const isDeleted = lines[row].trimStart().startsWith("-");
    if (isDeleted) {
      continue;
    }

    if (header[1] === "node") {
      if (header[3] !== undefined && header[4] !== undefined) {
        points.push({
          coords: [Number(header[3]), Number(header[4])],
          tagged: hasNodeTags(row)
        });
      }
      continue;
    }

    if (header[1] === "way") {
      segments.push(
        ...collectWaySegments(lines, row).map((segment) => segment.coords)
      );
    }
  }

  return { points, segments };
}

export function locateSelectionGeometry(text, selectionStart, memberObjectRow = undefined, highlight = false) {
  const lines = splitLines(text);
  const selectionRow = getSelectionRow(text, selectionStart);
  let row = memberObjectRow === undefined ? selectionRow : memberObjectRow;

  if (row >= lines.length) {
    return { center: null, segments: [] };
  }

  const headerRow = findHeaderRow(lines, row);
  if (headerRow < 0) {
    return { center: null, segments: [] };
  }

  if (row === headerRow) {
    row += 1;
  }

  const header = parseHeader(lines[headerRow]);
  if (!header) {
    return { center: null, segments: [] };
  }

  if (header[1] === "node") {
    if (header[3] !== undefined && header[4] !== undefined) {
      return {
        center: [Number(header[3]), Number(header[4])],
        segments: []
      };
    }

    return { center: null, segments: [] };
  }

  if (header[1] === "way") {
    let nodeRow = row;
    let selectedNodeMatch = null;

    while (nodeRow < lines.length && !HEADER_RE.test(lines[nodeRow])) {
      selectedNodeMatch = ND_RE.exec(lines[nodeRow]);
      if (selectedNodeMatch) {
        break;
      }
      nodeRow += 1;
    }

    if (!selectedNodeMatch) {
      return { center: null, segments: [] };
    }

    const center = findNodeCoords(lines, selectedNodeMatch[1]);
    if (!center) {
      return { center: null, segments: [] };
    }

    return {
      center,
      segments: collectWaySegments(lines, headerRow, highlight)
    };
  }

  return { center: null, segments: [] };
}

export function applyCoordsToSelection(text, selectionStart, coords) {
  const lines = splitLines(text);
  const row = getSelectionRow(text, selectionStart);
  const headerRow = findHeaderRow(lines, row);

  if (coords === "" || row >= lines.length || headerRow < 0) {
    return text;
  }

  const header = parseHeader(lines[headerRow]);
  if (!header) {
    return text;
  }

  if (header[1] === "node") {
    const match = NODE_SET_RE.exec(lines[headerRow]);
    if (!match) {
      return text;
    }

    lines[headerRow] = `${match[1]}${match[3] ? match[3] : ": "}${coords}${match[5] || ""}`;
    return lines.join("\n");
  }

  if (header[1] === "way") {
    const nodeMatch = ND_RE.exec(lines[row]);
    if (!nodeMatch) {
      return text;
    }

    for (let index = 0; index < lines.length; index += 1) {
      const nodeLineMatch = NODE_SET_RE.exec(lines[index]);
      if (nodeLineMatch && nodeLineMatch[2] === nodeMatch[1]) {
        lines[index] = `${nodeLineMatch[1]}${nodeLineMatch[3] ? nodeLineMatch[3] : ": "}${coords}${nodeLineMatch[5] || ""}`;
        break;
      }
    }
  }

  return lines.join("\n");
}
