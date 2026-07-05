import test from "node:test";
import assert from "node:assert/strict";

import {
  countLineRegexOccurrences,
  countLiteralOccurrences,
  replaceAllLineRegex,
  replaceAllLiteral
} from "../src/js/search-replace.js";

test("countLiteralOccurrences counts literal matches only", () => {
  assert.equal(countLiteralOccurrences("node 1\nnode 2\nway 3", "node"), 2);
  assert.equal(countLiteralOccurrences("aaaa", "aa"), 2);
  assert.equal(countLiteralOccurrences("abc", ""), 0);
});

test("replaceAllLiteral replaces all literal matches", () => {
  assert.equal(replaceAllLiteral("node 1\nnode 2", "node", "way"), "way 1\nway 2");
  assert.equal(replaceAllLiteral("abc", "", "x"), "abc");
});

test("countLineRegexOccurrences counts regex matches on each line", () => {
  assert.equal(countLineRegexOccurrences("node 1\nnode 2\nway 3", "^node (\\d+)$"), 2);
  assert.equal(countLineRegexOccurrences("aa\naa", "a"), 4);
  assert.equal(countLineRegexOccurrences("abc", ""), 0);
  assert.throws(() => countLineRegexOccurrences("abc", "("), SyntaxError);
});

test("replaceAllLineRegex replaces regex matches with captured groups on each line", () => {
  assert.equal(
    replaceAllLineRegex("node 123: name=A\nway 45: name=B", "^(node|way) (\\d+): (.*)$", "$2 $1 $3"),
    "123 node name=A\n45 way name=B"
  );
  assert.equal(replaceAllLineRegex("a\nb", "a\\nb", "x"), "a\nb");
  assert.equal(replaceAllLineRegex("abc", "", "x"), "abc");
});
