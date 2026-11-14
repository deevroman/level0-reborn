import test from "node:test";
import assert from "node:assert/strict";

import { fetchWithRetry } from "../src/js/network.js";

test("fetchWithRetry retries an HTTP 503 response after confirmation", async () => {
  const url = "https://api.example.test/data";
  let calls = 0;
  const prompts = [];

  const response = await fetchWithRetry(
    url,
    undefined,
    async () => {
      calls += 1;
      return { status: calls === 1 ? 503 : 200 };
    },
    (message) => {
      prompts.push(message);
      return true;
    }
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /HTTP 503/);
  assert.match(prompts[0], new RegExp(url));
});

test("fetchWithRetry offers to retry an HTTP 502 response", async () => {
  const url = "https://api.example.test/data";
  let calls = 0;
  let prompt;

  const response = await fetchWithRetry(url, undefined, async () => {
    calls += 1;
    return { status: calls === 1 ? 502 : 200 };
  }, (message) => {
    prompt = message;
    return true;
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.match(prompt, /HTTP 502/);
  assert.ok(prompt.includes(url));
});

test("fetchWithRetry asks before propagating a network error", async () => {
  const url = "https://api.example.test/data";
  const failure = new TypeError("Failed to fetch");
  const prompts = [];

  await assert.rejects(
    fetchWithRetry(
      url,
      undefined,
      async () => {
        throw failure;
      },
      (message) => {
        prompts.push(message);
        return false;
      }
    ),
    failure
  );

  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /network error/i);
  assert.match(prompts[0], new RegExp(url));
});
