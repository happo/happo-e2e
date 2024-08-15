const crypto = require('crypto');
const fs = require('fs');

const mkdirp = require('mkdirp');
const nodeFetch = require('node-fetch');
const imageSize = require('image-size');

const { RemoteBrowserTarget } = require('happo.io');
const createAssetPackage = require('./src/createAssetPackage');
const findCSSAssetUrls = require('./src/findCSSAssetUrls');

const makeRequest = require('happo.io/build/makeRequest').default;

const proxiedFetch = require('./src/fetch');
const loadHappoConfig = require('./src/loadHappoConfig');
const makeAbsolute = require('./src/makeAbsolute');
const makeExternalUrlsAbsolute = require('./src/makeExternalUrlsAbsolute');
const resolveEnvironment = require('./src/resolveEnvironment');
const convertBase64FileToReal = require('./src/convertBase64FileToReal');

const { HAPPO_E2E_PORT, HAPPO_DEBUG, HAPPO_ENABLED } = process.env;

function getUniqueUrls(urls) {
  const seenKeys = new Set();
  const result = [];
  urls.forEach((url) => {
    const key = [url.url, url.baseUrl].join('||');
    if (!seenKeys.has(key)) {
      result.push(url);
      seenKeys.add(key);
    }
  });
  return urls;
}

function ampersands(string) {
  return string.replace(/&/g, '&amp;');
}

async function downloadCSSContent(blocks) {
  const promises = blocks.map(async (block) => {
    if (block.href) {
      const absUrl = makeAbsolute(block.href, block.baseUrl);
      if (HAPPO_DEBUG) {
        console.log(`[HAPPO] Downloading CSS file from ${absUrl}`);
      }

      let res;
      try {
        res = await proxiedFetch(absUrl, { retryCount: 5 });
      } catch (e) {
        console.warn(
          `[HAPPO] Failed to fetch CSS file from ${block.href} (using base URL ${block.baseUrl}). This might mean styles are missing in your Happo screenshots`,
        );
        return;
      }

      let text = await res.text();
      if (HAPPO_DEBUG) {
        console.log(
          `[HAPPO] Done downloading CSS file from ${absUrl}. Got ${text.length} chars back.`,
        );
      }

      if (!absUrl.startsWith(block.baseUrl)) {
        text = makeExternalUrlsAbsolute(text, absUrl);
      }

      block.content = text;
      block.assetsBaseUrl = absUrl.replace(/\/[^/]*$/, '/');
      delete block.href;
    }
  });

  await Promise.all(promises);
}

class Controller {
  async init() {
    this.snapshots = [];
    this.allCssBlocks = [];
    this.snapshotAssetUrls = [];
    this.localSnapshots = [];
    this.localSnapshotImages = {};
    this.knownComponentVariants = {};

    if (!(HAPPO_E2E_PORT || HAPPO_ENABLED)) {
      console.log(
        `
[HAPPO] Happo is disabled. Here's how to enable it:
  - Use the \`happo-e2e\` wrapper.
  - Set \`HAPPO_ENABLED=true\`.

Docs:
  https://docs.happo.io/docs/cypress#usage-with-cypress-run
  https://docs.happo.io/docs/cypress#usage-with-cypress-open
      `.trim(),
      );
      return null;
    }
    if (HAPPO_DEBUG) {
      console.log('[HAPPO] Running Controller.init');
    }
    this.happoConfig = await loadHappoConfig();
  }

  isActive() {
    const result = !!this.happoConfig;
    if (HAPPO_DEBUG) {
      console.log('[HAPPO] Controller.isActive()?', result);
    }
    return result;
  }

  async uploadAssetsIfNeeded({ buffer, hash }) {
    if (HAPPO_DEBUG) {
      console.log(`[HAPPO] Checking if we need to upload assets`);
    }

    try {
      // Check if the assets already exist. If so, we don't have to upload them.
      const assetsDataRes = await makeRequest(
        {
          url: `${this.happoConfig.endpoint}/api/snap-requests/assets-data/${hash}`,
          method: 'GET',
          json: true,
        },
        { ...this.happoConfig },
      );
      if (HAPPO_DEBUG) {
        console.log(
          `[HAPPO] Reusing existing assets at ${assetsDataRes.path} (previously uploaded on ${assetsDataRes.uploadedAt})`,
        );
      }
      return assetsDataRes.path;
    } catch (e) {
      if (e.statusCode !== 404) {
        throw e;
      }
    }

    if (HAPPO_DEBUG) {
      console.log(`[HAPPO] Uploading assets package`);
    }
    const assetsRes = await makeRequest(
      {
        url: `${this.happoConfig.endpoint}/api/snap-requests/assets/${hash}`,
        method: 'POST',
        json: true,
        formData: {
          payload: {
            options: {
              filename: 'payload.zip',
              contentType: 'application/zip',
            },
            value: buffer,
          },
        },
      },
      { ...this.happoConfig, maxTries: 3 },
    );
    if (HAPPO_DEBUG) {
      console.log('[HAPPO] Done uploading assets package, got', assetsRes);
    }
    return assetsRes.path;
  }

  async finish() {
    if (HAPPO_DEBUG) {
      console.log('[HAPPO] Running Controller.finish');
    }
    if (this.localSnapshots.length) {
      if (HAPPO_DEBUG) {
        console.log(
          `[HAPPO] Processing ${this.localSnapshots.length} local snapshots`,
        );
      }
      await this.processSnapRequestIds([await this.uploadLocalSnapshots()]);
      return null;
    }
    if (!this.snapshots.length) {
      if (HAPPO_DEBUG) {
        console.log('[HAPPO] No snapshots recorded');
      }
      return null;
    }
    this.dedupeSnapshots();
    await downloadCSSContent(this.allCssBlocks);
    const allUrls = [...this.snapshotAssetUrls];
    this.allCssBlocks.forEach((block) => {
      findCSSAssetUrls(block.content).forEach((url) =>
        allUrls.push({ url, baseUrl: block.assetsBaseUrl || block.baseUrl }),
      );
    });

    const uniqueUrls = getUniqueUrls(allUrls);
    const { buffer, hash } = await createAssetPackage(uniqueUrls);

    const assetsPath = await this.uploadAssetsIfNeeded({ buffer, hash });

    const globalCSS = this.allCssBlocks.map((block) => ({
      id: block.key,
      conditional: true,
      css: block.content,
    }));
    for (const url of uniqueUrls) {
      if (/^\/_external\//.test(url.name) && url.name !== url.url) {
        for (const block of globalCSS) {
          block.css = block.css.split(url.url).join(url.name);
        }
        this.snapshots.forEach((snapshot) => {
          snapshot.html = snapshot.html.split(url.url).join(url.name);
          if (/&/.test(url.url)) {
            // When URL has an ampersand, we need to make sure the html wasn't
            // escaped so we replace again, this time with "&" replaced by
            // "&amp;"
            snapshot.html = snapshot.html.split(ampersands(url.url)).join(url.name);
          }
        });
      }
    }
    const allRequestIds = [];
    for (const name of Object.keys(this.happoConfig.targets)) {
      if (HAPPO_DEBUG) {
        console.log(`[HAPPO] Sending snap-request(s) for target=${name}`);
      }
      const snapshotsForTarget = this.snapshots.filter(
        ({ targets }) => !targets || targets.includes(name),
      );
      if (!snapshotsForTarget.length) {
        if (HAPPO_DEBUG) {
          console.log(`[HAPPO] No snapshots recorded for target=${name}. Skipping.`);
        }
        continue;
      }

      const requestIds = await this.happoConfig.targets[name].execute({
        targetName: name,
        asyncResults: true,
        endpoint: this.happoConfig.endpoint,
        globalCSS,
        assetsPackage: assetsPath,
        snapPayloads: snapshotsForTarget,
        apiKey: this.happoConfig.apiKey,
        apiSecret: this.happoConfig.apiSecret,
      });
      if (HAPPO_DEBUG) {
        console.log(
          `[HAPPO] Snap-request(s) for target=${name} created with ID(s)=${requestIds.join(
            ',',
          )}`,
        );
      }
      allRequestIds.push(...requestIds);
    }
    await this.processSnapRequestIds(allRequestIds);
  }

  async registerSnapshot({
    timestamp,
    html,
    assetUrls,
    cssBlocks,
    component,
    variant,
    targets: rawTargets,
    htmlElementAttrs,
    bodyElementAttrs,
  }) {
    if (!component) {
      throw new Error('Missing `component`');
    }
    if (!variant) {
      throw new Error('Missing `variant`');
    }

    if (HAPPO_DEBUG) {
      console.log(`[HAPPO] Registering snapshot for ${component} > ${variant}`);
    }
    this.snapshotAssetUrls.push(...assetUrls);
    const targets = this.handleDynamicTargets(rawTargets);
    this.snapshots.push({
      timestamp,
      html,
      component,
      variant,
      targets,
      stylesheets: cssBlocks.map((b) => b.key),
      htmlElementAttrs,
      bodyElementAttrs,
    });
    cssBlocks.forEach((block) => {
      if (this.allCssBlocks.some((b) => b.key === block.key)) {
        return;
      }
      this.allCssBlocks.push(block);
    });
  }

  async registerLocalSnapshot({
    component,
    variant: rawVariant,
    targets,
    target,
    width,
    height,

    // One of path, buffer is required
    path,
    buffer,
  }) {
    const variant = this.dedupeVariant(component, rawVariant);

    if (!width && !height && buffer) {
      const dimensions = imageSize(buffer);
      width = dimensions.width;
      height = dimensions.height;
    }

    this.localSnapshots.push({
      component,
      variant,
      targets,
      target,
      url: await this.uploadImage(path || buffer),
      width,
      height,
    });
  }

  removeSnapshotsMadeBetween({ start, end }) {
    if (HAPPO_DEBUG) {
      console.log(
        `[HAPPO] Removing snapshots made between ${new Date(
          start,
        )} and ${new Date(end)}`,
      );
    }
    this.snapshots = this.snapshots.filter(({ timestamp }) => {
      if (!timestamp) {
        return true;
      }
      return timestamp < start || timestamp > end;
    });
  }

  removeDuplicatesInTimeframe({ start, end }) {
    if (HAPPO_DEBUG) {
      console.log(
        `[HAPPO] Removing duplicate snapshots made between ${new Date(
          start,
        )} and ${new Date(end)}`,
      );
    }
    const seenSnapshots = {};
    this.snapshots = this.snapshots.filter((snapshot) => {
      const { timestamp, component, variant } = snapshot;
      if (!timestamp) {
        return true;
      }
      const id = [component, variant].join('-_|_-');
      const inTimeframe = timestamp >= start && timestamp <= end;
      if (inTimeframe) {
        if (seenSnapshots[id]) {
          // Found a duplicate made in the timeframe specified
          if (HAPPO_DEBUG) {
            console.log(
              `[HAPPO] Found duplicate snapshot to remove: "${component}", "${variant}" at timestamp ${new Date(
                timestamp,
              )}`,
            );
          }
          return false;
        }
        seenSnapshots[id] = true;
      }
      return true;
    });
  }

  async processSnapRequestIds(allRequestIds) {
    if (HAPPO_E2E_PORT) {
      // We're running with `happo-cypress --`
      const fetchRes = await nodeFetch(`http://localhost:${HAPPO_E2E_PORT}/`, {
        method: 'POST',
        body: allRequestIds.join('\n'),
      });
      if (!fetchRes.ok) {
        throw new Error('Failed to communicate with happo-e2e server');
      }
    } else {
      // We're not running with `happo-e2e --`. We'll create a report
      // despite the fact that it might not contain all the snapshots. This is
      // still helpful when running e.g. `cypress open` locally.
      const { afterSha } = resolveEnvironment();
      const reportResult = await makeRequest(
        {
          url: `${this.happoConfig.endpoint}/api/async-reports/${afterSha}`,
          method: 'POST',
          json: true,
          body: {
            requestIds: allRequestIds,
            project: this.happoConfig.project,
          },
        },
        { ...this.happoConfig, maxTries: 3 },
      );
      console.log(`[HAPPO] ${reportResult.url}`);

      // Reset the component variants so that we can run the test again while
      // cypress is still open.
      this.knownComponentVariants = {};
      return null;
    }
  }

  handleDynamicTargets(targets) {
    const result = [];
    if (typeof targets === 'undefined') {
      // return non-dynamic targets from .happo.js
      return Object.keys(this.happoConfig.targets).filter(
        (targetName) => !this.happoConfig.targets[targetName].__dynamic,
      );
    }
    for (const target of targets) {
      if (typeof target === 'string') {
        result.push(target);
      }
      if (
        typeof target === 'object' &&
        target.name &&
        target.viewport &&
        target.browser
      ) {
        if (this.happoConfig.targets[target.name]) {
          // already added
        } else {
          // add dynamic target
          this.happoConfig.targets[target.name] = new RemoteBrowserTarget(
            target.browser,
            target,
          );
          this.happoConfig.targets[target.name].__dynamic = true;
        }
        result.push(target.name);
      }
    }
    return result;
  }
  async uploadImage(pathOrBuffer) {
    const pathToFile = Buffer.isBuffer(pathOrBuffer) ? undefined : pathOrBuffer;
    if (HAPPO_DEBUG) {
      console.log(`[HAPPO] Uploading image ${pathToFile || ''}`);
    }
    const buffer = pathToFile
      ? await fs.promises.readFile(pathToFile)
      : pathOrBuffer;
    const hash = crypto.createHash('md5').update(buffer).digest('hex');

    const uploadUrlResult = await makeRequest(
      {
        url: `${this.happoConfig.endpoint}/api/images/${hash}/upload-url`,
        method: 'GET',
        json: true,
      },
      { ...this.happoConfig, maxTries: 2 },
    );

    if (!uploadUrlResult.uploadUrl) {
      // image has already been uploaded
      if (HAPPO_DEBUG) {
        console.log(
          `[HAPPO] Image has already been uploaded: ${uploadUrlResult.url}`,
        );
      }
      return uploadUrlResult.url;
    }

    const uploadResult = await makeRequest(
      {
        url: uploadUrlResult.uploadUrl,
        method: 'POST',
        json: true,
        formData: {
          file: {
            options: {
              filename: 'image.png',
              contentType: 'image/png',
            },
            value: buffer,
          },
        },
      },
      { ...this.happoConfig, maxTries: 2 },
    );
    if (HAPPO_DEBUG) {
      console.log(`[HAPPO] Uploaded image: ${uploadUrlResult.url}`);
    }
    return uploadResult.url;
  }

  async uploadLocalSnapshots() {
    const reportResult = await makeRequest(
      {
        url: `${this.happoConfig.endpoint}/api/snap-requests/with-results`,
        method: 'POST',
        json: true,
        body: {
          snaps: this.localSnapshots,
        },
      },
      { ...this.happoConfig, maxTries: 3 },
    );
    return reportResult.requestId;
  }

  dedupeVariant(component, variant) {
    this.knownComponentVariants[component] =
      this.knownComponentVariants[component] || {};
    const comp = this.knownComponentVariants[component];
    comp[variant] = comp[variant] || 0;
    comp[variant]++;
    if (comp[variant] === 1) {
      return variant;
    }
    return `${variant}-${comp[variant]}`;
  }

  dedupeSnapshots() {
    for (const snapshot of this.snapshots) {
      snapshot.variant = this.dedupeVariant(snapshot.component, snapshot.variant);
    }
  }

  async registerBase64ImageChunk({ base64Chunk, src, isFirst, isLast }) {
    const filename = src.slice(1);
    const filenameB64 = `${filename}.b64`;
    if (isFirst) {
      await mkdirp('.happo-tmp/_inlined');
      await new Promise((resolve, reject) =>
        fs.writeFile(filenameB64, base64Chunk, (e) => {
          if (e) {
            reject(e);
          } else {
            resolve();
          }
        }),
      );
    } else {
      await new Promise((resolve, reject) =>
        fs.appendFile(filenameB64, base64Chunk, (e) => {
          if (e) {
            reject(e);
          } else {
            resolve();
          }
        }),
      );
    }

    if (isLast) {
      await convertBase64FileToReal(filenameB64, filename);
    }
  }
}

module.exports = Controller;
