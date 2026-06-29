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
