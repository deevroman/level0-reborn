export function countLiteralOccurrences(text, needle) {
  if (!needle) {
    return 0;
  }

  return text.split(needle).length - 1;
}

export function replaceAllLiteral(text, search, replacement) {
  if (!search) {
    return text;
  }

  return text.split(search).join(replacement);
}

function createLineRegex(pattern) {
  return new RegExp(pattern, "g");
}

function splitPreservingLineEndings(text) {
  return text.split(/(\r\n|\n|\r)/);
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
