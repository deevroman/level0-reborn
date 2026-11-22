/**
 * @param {{userAgent?: string, brave?: unknown}} browser Browser identification data.
 * @returns {boolean} Whether the browser identifies itself as Chrome.
 */
export function isChromeBrowser(browser) {
  const userAgent = browser?.userAgent ?? "";
  return /\b(?:Chrome|CriOS)\//.test(userAgent)
    && !/\b(?:Edg|EdgA|EdgiOS|OPR|OPiOS|SamsungBrowser|Vivaldi|YaBrowser)\//.test(userAgent)
    && !browser?.brave;
}

/**
 * Applies a search replacement, avoiding Chrome's slow undoable insert for Replace All.
 * @param {HTMLTextAreaElement} editor Editor to update.
 * @param {string} text Replacement text for the entire editor.
 * @param {boolean} replaceAll Whether this is a Replace All operation.
 * @param {{userAgent?: string, brave?: unknown}} browser Browser identification data.
 * @param {Document} documentRef Document providing the native editing command.
 * @returns {boolean} Whether the text was updated.
 */
export function applyEditorReplacement(editor, text, replaceAll, browser, documentRef) {
  editor.focus();
  if (replaceAll && isChromeBrowser(browser)) {
    editor.value = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  editor.setSelectionRange(0, editor.value.length);
  const applied = text.length > 0
    ? documentRef.execCommand("insertText", false, text)
    : documentRef.execCommand("delete");
  if (!applied) {
    editor.setSelectionRange(0, 0);
  }
  return applied;
}
