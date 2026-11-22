import test from "node:test";
import assert from "node:assert/strict";
import { applyEditorReplacement, isChromeBrowser } from "../src/js/editor-replacement.js";

const chrome = { userAgent: "Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36" };
const firefox = { userAgent: "Mozilla/5.0 Firefox/130.0" };

function makeEditor(value) {
  return {
    value,
    events: [],
    selections: [],
    focus() {},
    setSelectionRange(start, end) { this.selections.push([start, end]); },
    dispatchEvent(event) { this.events.push(event); }
  };
}

test("identifies Chrome without treating other Chromium browsers as Chrome", () => {
  assert.equal(isChromeBrowser(chrome), true);
  assert.equal(isChromeBrowser({ userAgent: "Mozilla/5.0 CriOS/130.0 Mobile Safari/604.1" }), true);
  assert.equal(isChromeBrowser(firefox), false);
  assert.equal(isChromeBrowser({ userAgent: `${chrome.userAgent} Edg/130.0` }), false);
  assert.equal(isChromeBrowser({ userAgent: `${chrome.userAgent} OPR/115.0` }), false);
  assert.equal(isChromeBrowser({ ...chrome, brave: {} }), false);
});

test("Chrome Replace All updates the editor without a native editing command", () => {
  const editor = makeEditor("old old");
  const doc = { execCommand() { assert.fail("execCommand should not be called"); } };
  assert.equal(applyEditorReplacement(editor, "new new", true, chrome, doc), true);
  assert.equal(editor.value, "new new");
  assert.equal(editor.events.length, 1);
  assert.equal(editor.events[0].type, "input");
  assert.equal(editor.events[0].bubbles, true);
  assert.deepEqual(editor.selections, []);
});

test("single replacement in Chrome and Replace All in Firefox keep native undo", () => {
  for (const [replaceAll, browser] of [[false, chrome], [true, firefox]]) {
    const editor = makeEditor("old text");
    let args;
    const doc = { execCommand(...received) { args = received; return true; } };
    assert.equal(applyEditorReplacement(editor, "new text", replaceAll, browser, doc), true);
    assert.deepEqual(editor.selections, [[0, 8]]);
    assert.deepEqual(args, ["insertText", false, "new text"]);
  }
});

test("failed native replacement clears the selection and reports failure", () => {
  const editor = makeEditor("old");
  assert.equal(applyEditorReplacement(editor, "", true, firefox, { execCommand: () => false }), false);
  assert.deepEqual(editor.selections, [[0, 3], [0, 0]]);
});
