const crypto = require('crypto');
const fs = require('fs');

const mkdirp = require('mkdirp');
const nodeFetch = require('node-fetch');

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
  urls.forEach(url => {
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
  const promises = blocks.map(async block => {
    if (block.href) {
      const absUrl = makeAbsolute(block.href, block.baseUrl);
      if (HAPPO_DEBUG) {
        console.log(`[HAPPO] Downloading CSS file from ${absUrl}`);
      }
      const res = await proxiedFetch(absUrl);
      if (!res.ok) {
        console.warn(
          `[HAPPO] Failed to fetch CSS file from ${block.href}. This might mean styles are missing in your Happo screenshots`,
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
    return !!this.happoConfig;
  }

  async finish() {
    if (this.localSnapshots.length) {
      await this.processSnapRequestIds([await this.uploadLocalSnapshots()]);
      return null;
    }
    if (!this.snapshots.length) {
      return null;
    }
    this.dedupeSnapshots();
    await downloadCSSContent(this.allCssBlocks);
    const allUrls = [...this.snapshotAssetUrls];
    this.allCssBlocks.forEach(block => {
      findCSSAssetUrls(block.content).forEach(url =>
        allUrls.push({ url, baseUrl: block.assetsBaseUrl || block.baseUrl }),
      );
    });

    const uniqueUrls = getUniqueUrls(allUrls);
    const { buffer, hash } = await createAssetPackage(uniqueUrls);

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

    let globalCSS = this.allCssBlocks.map(block => block.content).join('\n');
    for (const url of uniqueUrls) {
      if (/^\/_external\//.test(url.name) && url.name !== url.url) {
        globalCSS = globalCSS.split(url.url).join(url.name);
        this.snapshots.forEach(snapshot => {
          snapshot.html = snapshot.html.split(url.url).join(url.name);
          if (/&/.test.snapshot.url) {
            // When URL has an ampersand, we need to make sure the html wasn't
            // escaped so we replace again, this time with "&" replaced by
            // "&amp;"
            snapshot.html = snapshot.html
              .split(ampersands(url.url))
              .join(url.name);
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
      const requestIds = await this.happoConfig.targets[name].execute({
        targetName: name,
        asyncResults: true,
        endpoint: this.happoConfig.endpoint,
        globalCSS,
        assetsPackage: assetsRes.path,
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
    this.snapshotAssetUrls.push(...assetUrls);
    const targets = this.handleDynamicTargets(rawTargets);
    this.snapshots.push({
      timestamp,
      html,
      component,
      variant,
      targets,
      htmlElementAttrs,
      bodyElementAttrs,
    });
    cssBlocks.forEach(block => {
      if (this.allCssBlocks.some(b => b.key === block.key)) {
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
    path,
    width,
    height,
  }) {
    const variant = this.dedupeVariant(component, rawVariant);
    this.localSnapshots.push({
      component,
      variant,
      targets,
      target,
      url: await this.uploadImage(path),
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
        targetName => !this.happoConfig.targets[targetName].__dynamic,
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
  async uploadImage(pathToFile) {
    if (HAPPO_DEBUG) {
      console.log(`[HAPPO] Uploading image: ${pathToFile}`);
    }
    const buffer = await fs.promises.readFile(pathToFile);
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
      snapshot.variant = this.dedupeVariant(
        snapshot.component,
        snapshot.variant,
      );
    }
  }

  async registerBase64ImageChunk({ base64Chunk, src, isFirst, isLast }) {
    const filename = src.slice(1);
    const filenameB64 = `${filename}.b64`;
    if (isFirst) {
      await mkdirp('.happo-tmp/_inlined');
      await new Promise((resolve, reject) =>
        fs.writeFile(filenameB64, base64Chunk, e => {
          if (e) {
            reject(e);
          } else {
            resolve();
          }
        }),
      );
    } else {
      await new Promise((resolve, reject) =>
        fs.appendFile(filenameB64, base64Chunk, e => {
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
