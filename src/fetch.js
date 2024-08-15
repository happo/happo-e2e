const nodeFetch = require('node-fetch');
const HttpsProxyAgent = require('https-proxy-agent');
const asyncRetry = require('async-retry');

const { HTTP_PROXY, HAPPO_DEBUG } = process.env;

const fetchOptions = {};
if (HTTP_PROXY) {
  fetchOptions.agent = new HttpsProxyAgent(HTTP_PROXY);
}
if (HAPPO_DEBUG) {
  console.log(`[HAPPO] using the following node-fetch options`, fetchOptions);
}

module.exports = async function fetch(url, { retryCount = 0 }) {
  return asyncRetry(
    async () => {
      const response = await nodeFetch(url, fetchOptions);

      if (!response.ok) {
        const e = new Error(
          `[HAPPO] Request to ${url} failed: ${response.status} - ${await response.text()}`,
        );
        e.statusCode = response.status;
        throw e;
      }

      return response;
    },
    {
      retries: retryCount,
      onRetry: (e) => {
        console.warn(`[HAPPO] Failed fetching ${url}. Retrying...`);
        console.warn(e);
      },
    },
  );
};
