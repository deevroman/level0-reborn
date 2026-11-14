import test from "node:test";
import assert from "node:assert/strict";

import {
  countLineRegexOccurrences,
  countLiteralOccurrences,
  findLineRegexMatch,
  findLiteralMatch,
  findSearchHighlights,
  replaceAllLineRegex,
  replaceAllLiteral,
  replaceFirstLineRegex,
  replaceFirstLiteral,
  replaceSearchMatch,
  shouldEnableRegexForSearch,
  updateAutomaticRegexMode
} from "../src/js/search-replace.js";

test("typing after an automatically detected trailing dollar restores literal mode", () => {
  const auto = updateAutomaticRegexMode("price", "price$", false, false);
  assert.deepEqual(auto, { enabled: true, enabledByTrailingDollar: true });
  assert.deepEqual(updateAutomaticRegexMode("price$", "price$x", auto.enabled, auto.enabledByTrailingDollar),
    { enabled: false, enabledByTrailingDollar: false });
  assert.deepEqual(updateAutomaticRegexMode("price$", "price$x", true, false),
    { enabled: true, enabledByTrailingDollar: false });
  assert.deepEqual(updateAutomaticRegexMode("a$", "a$\\d", true, true),
    { enabled: true, enabledByTrailingDollar: true });
});

test("regex mode is suggested for a leading caret or trailing dollar", () => {
  assert.equal(shouldEnableRegexForSearch("^name"), true);
  assert.equal(shouldEnableRegexForSearch("name$"), true);
  assert.equal(shouldEnableRegexForSearch("^"), true);
  assert.equal(shouldEnableRegexForSearch("$"), true);
  assert.equal(shouldEnableRegexForSearch("name"), false);
  assert.equal(shouldEnableRegexForSearch("a^b$c"), false);
  assert.equal(shouldEnableRegexForSearch(""), false);
});

test("regex mode is suggested for common regex sequences", () => {
  for (const search of ["name.*suffix", "a.+b", "\\d+", "\\s", "\\w", "\\D", "\\S", "\\W"]) {
    assert.equal(shouldEnableRegexForSearch(search), true, search);
  }
  for (const search of ["a.b", "a+b", "\\\\d", "\\.*", "ordinary text"]) {
    assert.equal(shouldEnableRegexForSearch(search), false, search);
  }
});

test("replaceSearchMatch replaces the selected occurrence, including regex groups", () => {
  const text = "node 1\nnode 2\nnode 3";
  const literalMatch = findLiteralMatch(text, "node", 1);
  assert.equal(replaceSearchMatch(text, "node", "way", false, literalMatch), "node 1\nway 2\nnode 3");
  const regexMatch = findLineRegexMatch(text, "^node (\\d+)$", 1);
  assert.equal(replaceSearchMatch(text, "^node (\\d+)$", "way $1", true, regexMatch), "node 1\nway 2\nnode 3");
});

test("findSearchHighlights finds literal and line-by-line regex matches", () => {
  assert.deepEqual(findSearchHighlights("abc\nabc", "abc", false), [
    { index: 0, length: 3 }, { index: 4, length: 3 }
  ]);
  assert.deepEqual(findSearchHighlights("ab\r\nab", "^a", true), [
    { index: 0, length: 1 }, { index: 4, length: 1 }
  ]);
  assert.deepEqual(findSearchHighlights("abc", "^", true), []);
  assert.deepEqual(findSearchHighlights("a\nb", "^", true, true), [
    { index: 0, length: 0 }, { index: 2, length: 0 }
  ]);
  assert.throws(() => findSearchHighlights("abc", "(", true), SyntaxError);
});

test("countLiteralOccurrences counts literal matches only", () => {
  assert.equal(countLiteralOccurrences("node 1\nnode 2\nway 3", "node"), 2);
  assert.equal(countLiteralOccurrences("aaaa", "aa"), 2);
  assert.equal(countLiteralOccurrences("abc", ""), 0);
});

test("findLiteralMatch returns the first match at or after the specified index", () => {
  assert.deepEqual(findLiteralMatch("node 1\nnode 2", "node"), { index: 0, length: 4 });
  assert.deepEqual(findLiteralMatch("node 1\nnode 2", "node", 1), { index: 7, length: 4 });
  assert.equal(findLiteralMatch("node", "way"), null);
});

test("replaceAllLiteral replaces all literal matches", () => {
  assert.equal(replaceAllLiteral("node 1\nnode 2", "node", "way"), "way 1\nway 2");
  assert.equal(replaceAllLiteral("abc", "", "x"), "abc");
});

test("replaceFirstLiteral replaces only the first literal match", () => {
  assert.equal(replaceFirstLiteral("node 1\nnode 2", "node", "way"), "way 1\nnode 2");
  assert.equal(replaceFirstLiteral("abc", "", "x"), "abc");
});

test("countLineRegexOccurrences counts regex matches on each line", () => {
  assert.equal(countLineRegexOccurrences("node 1\nnode 2\nway 3", "^node (\\d+)$"), 2);
  assert.equal(countLineRegexOccurrences("aa\naa", "a"), 4);
  assert.equal(countLineRegexOccurrences("abc", ""), 0);
  assert.throws(() => countLineRegexOccurrences("abc", "("), SyntaxError);
});

test("findLineRegexMatch keeps line anchors and respects the specified index", () => {
  assert.deepEqual(
    findLineRegexMatch("node 1\nnode 2", "^node"),
    { index: 0, length: 4, partIndex: 0 }
  );
  assert.deepEqual(
    findLineRegexMatch("node 1\nnode 2", "^node", 1),
    { index: 7, length: 4, partIndex: 2 }
  );
});

test("replaceAllLineRegex replaces regex matches with captured groups on each line", () => {
  assert.equal(
    replaceAllLineRegex("node 123: name=A\nway 45: name=B", "^(node|way) (\\d+): (.*)$", "$2 $1 $3"),
    "123 node name=A\n45 way name=B"
  );
  assert.equal(replaceAllLineRegex("a\nb", "a\\nb", "x"), "a\nb");
  assert.equal(replaceAllLineRegex("abc", "", "x"), "abc");
});

test("replaceFirstLineRegex replaces only the first matching line", () => {
  assert.equal(
    replaceFirstLineRegex("node 123: name=A\nnode 45: name=B", "^(node) (\\d+): (.*)$", "$2 $1 $3"),
    "123 node name=A\nnode 45: name=B"
  );
  assert.equal(replaceFirstLineRegex("a\nb", "a\\nb", "x"), "a\nb");
});
