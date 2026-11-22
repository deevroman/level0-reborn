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
 * @param {Window} viewport Window whose page position should be preserved.
 * @param {() => void} action Search action to perform.
 * @returns {void}
 */
export function preservePageScroll(viewport, action) {
  const { scrollX, scrollY } = viewport;
  try {
    action();
  } finally {
    if (viewport.scrollX !== scrollX || viewport.scrollY !== scrollY) {
      viewport.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    }
  }
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
  const viewport = documentRef.defaultView;
  const scrollPosition = replaceAll ? {
    top: editor.scrollTop,
    left: editor.scrollLeft,
    pageTop: viewport?.scrollY,
    pageLeft: viewport?.scrollX
  } : null;

  try {
    if (replaceAll && isChromeBrowser(browser)) {
      const selectionStart = editor.selectionStart;
      const selectionEnd = editor.selectionEnd;
      const selectionDirection = editor.selectionDirection;
      editor.value = text;
      editor.setSelectionRange(
        Math.min(selectionStart, text.length),
        Math.min(selectionEnd, text.length),
        selectionDirection
      );
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    editor.focus({ preventScroll: true });
    editor.setSelectionRange(0, editor.value.length);
    const applied = text.length > 0
      ? documentRef.execCommand("insertText", false, text)
      : documentRef.execCommand("delete");
    if (!applied) {
      editor.setSelectionRange(0, 0);
    }
    return applied;
  } finally {
    if (scrollPosition) {
      editor.scrollTop = scrollPosition.top;
      editor.scrollLeft = scrollPosition.left;
      if (viewport && (viewport.scrollY !== scrollPosition.pageTop || viewport.scrollX !== scrollPosition.pageLeft)) {
        viewport.scrollTo({ top: scrollPosition.pageTop, left: scrollPosition.pageLeft, behavior: "instant" });
      }
    }
  }
}
