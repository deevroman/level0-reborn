import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Creates a read-only side-by-side comparison of the original and edited text.
 * @param {HTMLElement} parent Container for the comparison.
 * @param {string} before Original editor data.
 * @param {string} after Current editor text.
 * @returns {MergeView} The mounted view.
 */
export function createDiffView(parent, before, after) {
  const extensions = [EditorState.readOnly.of(true), EditorView.editable.of(false)];
  return new MergeView({
    a: { doc: before, extensions },
    b: { doc: after, extensions },
    parent,
    gutter: true
  });
}
