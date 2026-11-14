/**
 * @param {string} search
 * @returns {boolean}
 */
export function shouldEnableRegexForSearch(search) {
  return search.startsWith("^")
    || search.endsWith("$")
    || /(?:^|[^\\])(?:\\\\)*(?:\.\*|\.\+|\\[dDsSwW])/.test(search);
}

/**
 * @param {string} previousSearch
 * @param {string} search
 * @param {boolean} enabled
 * @param {boolean} enabledByTrailingDollar
 * @returns {{ enabled: boolean, enabledByTrailingDollar: boolean }}
 */
export function updateAutomaticRegexMode(previousSearch, search, enabled, enabledByTrailingDollar) {
  const hasRegexSyntax = shouldEnableRegexForSearch(search);
  const appendedAfterDollar = previousSearch.endsWith("$")
    && search.startsWith(previousSearch)
    && search.length > previousSearch.length
    && !search.endsWith("$");

  if (enabledByTrailingDollar && appendedAfterDollar && !hasRegexSyntax) {
    return { enabled: false, enabledByTrailingDollar: false };
  }
  if (!enabled && hasRegexSyntax) {
    return {
      enabled: true,
      enabledByTrailingDollar: search.endsWith("$") && !shouldEnableRegexForSearch(search.slice(0, -1))
    };
  }
  return { enabled, enabledByTrailingDollar };
}

export function countLiteralOccurrences(text, needle) {
  if (!needle) {
    return 0;
  }

  return text.split(needle).length - 1;
}

/**
 * @param {string} text
 * @param {string} search
 * @param {number} [startIndex]
 * @returns {{ index: number, length: number } | null}
 */
export function findLiteralMatch(text, search, startIndex = 0) {
  if (!search) {
    return null;
  }

  const index = text.indexOf(search, startIndex);
  return index === -1 ? null : { index, length: search.length };
}

export function replaceAllLiteral(text, search, replacement) {
  if (!search) {
    return text;
  }

  return text.split(search).join(replacement);
}

/**
 * @param {string} text
 * @param {string} search
 * @param {string} replacement
 * @returns {string}
 */
export function replaceFirstLiteral(text, search, replacement) {
  if (!search) {
    return text;
  }

  const match = findLiteralMatch(text, search);
  return match === null
    ? text
    : `${text.slice(0, match.index)}${replacement}${text.slice(match.index + match.length)}`;
}

function createLineRegex(pattern) {
  return new RegExp(pattern, "g");
}

function splitPreservingLineEndings(text) {
  return text.split(/(\r\n|\n|\r)/);
}

/**
 * Returns matches using the same literal or line-by-line regex semantics as replacement.
 * @param {string} text
 * @param {string} search
 * @param {boolean} regexEnabled
 * @param {boolean} [includeEmpty=false] Include zero-length regex matches.
 * @returns {{ index: number, length: number }[]}
 */
export function findSearchHighlights(text, search, regexEnabled, includeEmpty = false) {
  if (!search) {
    return [];
  }

  const matches = [];
  if (!regexEnabled) {
    let index = text.indexOf(search);
    while (index !== -1) {
      matches.push({ index, length: search.length });
      index = text.indexOf(search, index + search.length);
    }
    return matches;
  }

  const regex = createLineRegex(search);
  const parts = splitPreservingLineEndings(text);
  let lineStart = 0;
  for (let index = 0; index < parts.length; index += 2) {
    regex.lastIndex = 0;
    let match = regex.exec(parts[index]);
    while (match !== null) {
      if (match[0].length > 0 || includeEmpty) {
        matches.push({ index: lineStart + match.index, length: match[0].length });
      }
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
      match = regex.exec(parts[index]);
    }
    lineStart += parts[index].length + (parts[index + 1]?.length ?? 0);
  }
  return matches;
}

/**
 * @param {string} text
 * @param {string} pattern
 * @param {number} [startIndex]
 * @returns {{ index: number, length: number, partIndex: number } | null}
 */
export function findLineRegexMatch(text, pattern, startIndex = 0) {
  if (!pattern) {
    return null;
  }

  const regex = createLineRegex(pattern);
  const parts = splitPreservingLineEndings(text);
  let lineStart = 0;

  for (let partIndex = 0; partIndex < parts.length; partIndex += 2) {
    const line = parts[partIndex];
    regex.lastIndex = 0;

    let match = regex.exec(line);
    while (match !== null) {
      const index = lineStart + match.index;
      if (index >= startIndex) {
        return { index, length: match[0].length, partIndex };
      }

      if (match[0] === "") {
        regex.lastIndex += 1;
      }
      match = regex.exec(line);
    }

    lineStart += line.length + (parts[partIndex + 1]?.length ?? 0);
  }

  return null;
}

export function countLineRegexOccurrences(text, pattern) {
  if (!pattern) {
    return 0;
  }

  const regex = createLineRegex(pattern);
  const parts = splitPreservingLineEndings(text);
  let count = 0;

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    regex.lastIndex = 0;

    let match = regex.exec(line);
    while (match !== null) {
      count += 1;

      if (match[0] === "") {
        regex.lastIndex += 1;
      }

      match = regex.exec(line);
    }
  }

  return count;
}

export function replaceAllLineRegex(text, pattern, replacement) {
  if (!pattern) {
    return text;
  }

  const regex = createLineRegex(pattern);
  const parts = splitPreservingLineEndings(text);

  for (let index = 0; index < parts.length; index += 2) {
    regex.lastIndex = 0;
    parts[index] = parts[index].replace(regex, replacement);
  }

  return parts.join("");
}

/**
 * @param {string} text
 * @param {string} pattern
 * @param {string} replacement
 * @returns {string}
 */
export function replaceFirstLineRegex(text, pattern, replacement) {
  if (!pattern) {
    return text;
  }

  const match = findLineRegexMatch(text, pattern);
  if (match === null) {
    return text;
  }

  const regex = new RegExp(pattern);
  const parts = splitPreservingLineEndings(text);

  parts[match.partIndex] = parts[match.partIndex].replace(regex, replacement);

  return parts.join("");
}

/**
 * Replaces a specific match while preserving line-based regex replacement semantics.
 * @param {string} text
 * @param {string} search
 * @param {string} replacement
 * @param {boolean} regexEnabled
 * @param {{ index: number, length: number, partIndex?: number }} match
 * @returns {string}
 */
export function replaceSearchMatch(text, search, replacement, regexEnabled, match) {
  if (!regexEnabled) {
    return `${text.slice(0, match.index)}${replacement}${text.slice(match.index + match.length)}`;
  }

  const parts = splitPreservingLineEndings(text);
  const partIndex = match.partIndex;
  let lineStart = 0;
  for (let index = 0; index < partIndex; index += 1) {
    lineStart += parts[index].length;
  }
  const regex = new RegExp(search, "y");
  regex.lastIndex = match.index - lineStart;
  parts[partIndex] = parts[partIndex].replace(regex, replacement);
  return parts.join("");
}
