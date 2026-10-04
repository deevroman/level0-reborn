/**
 * @param {string} url
 * @param {string} reason
 * @param {((message: string) => boolean) | undefined} confirmImpl
 * @returns {boolean}
 */
function shouldRetry(url, reason, confirmImpl) {
  if (typeof confirmImpl !== "function") {
    return false;
  }

  return confirmImpl(`${reason} while requesting:\n${url}\n\nRetry the request?`);
}

/**
 * Performs a request and offers the user a retry after a network failure or HTTP 503 response.
 *
 * @param {string} url
 * @param {RequestInit | undefined} options
 * @param {typeof fetch} [fetchImpl]
 * @param {((message: string) => boolean) | undefined} [confirmImpl]
 * @returns {Promise<Response>}
 * @throws {Error} When the request fails and the user declines to retry.
 */
export async function fetchWithRetry(url, options, fetchImpl = fetch, confirmImpl = globalThis.confirm) {
  const requestUrl = String(url);

  while (true) {
    let response;

    try {
      response = await fetchImpl(url, options);
    } catch (error) {
      if (!shouldRetry(requestUrl, "A network error occurred", confirmImpl)) {
        throw error;
      }
      continue;
    }

    if (response.status !== 503 || !shouldRetry(requestUrl, "The server returned HTTP 503", confirmImpl)) {
      return response;
    }
  }
}
