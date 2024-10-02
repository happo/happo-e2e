const { Writable } = require('stream');
const crypto = require('crypto');

const Archiver = require('archiver');
const mime = require('mime-types');

const makeAbsolute = require('./makeAbsolute');
const proxiedFetch = require('./fetch');

const { HAPPO_DOWNLOAD_ALL, HAPPO_DEBUG } = process.env;

const FILE_CREATION_DATE = new Date('Fri March 20 2020 13:44:55 GMT+0100 (CET)');

function stripQueryParams(url) {
  const i = url.indexOf('?');
  if (i > -1) {
    return url.slice(0, i);
  }
  return url;
}

function normalize(url, baseUrl) {
  if (url.startsWith(baseUrl)) {
    return url.slice(baseUrl.length);
  }
  if (url.startsWith('/')) {
    return url.slice(1);
  }
  if (url.startsWith('../')) {
    return url.slice(3);
  }
  return url;
}

function getFileSuffixFromMimeType(mimeType = '') {
  const ext = mime.extension(mimeType);
  if (!ext) {
    return '';
  }
  return `.${ext}`;
}

module.exports = function createAssetPackage(urls) {
  if (HAPPO_DEBUG) {
    console.log(`[HAPPO] Creating asset package from urls`, urls);
  }
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    const seenUrls = new Set();
    const archive = new Archiver('zip', {
      // Concurrency in the stat queue leads to non-deterministic output.
      // https://github.com/archiverjs/node-archiver/issues/383#issuecomment-2253139948
      statConcurrency: 1,
    });
    archive.on('error', (e) => reject(e));

    // Create an in-memory stream
    const stream = new Writable();
    const data = [];
    stream._write = (chunk, enc, done) => {
      data.push(...chunk);
      done();
    };
    stream.on('error', (e) => console.error(e));
    stream.on('finish', () => {
      const buffer = Buffer.from(data);
      const hash = crypto.createHash('md5').update(buffer).digest('hex');
      if (HAPPO_DEBUG) {
        console.log(
          `[HAPPO] Done creating asset package, hash=${hash} total bytes=${buffer.length}`,
        );
      }
      resolve({ buffer, hash });
    });
    archive.pipe(stream);

    const promises = urls.map(async (item) => {
      const { url, baseUrl } = item;
      const isExternalUrl = /^https?:/.test(url);
      const isLocalhost = /\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url);
      if (!HAPPO_DOWNLOAD_ALL && isExternalUrl && !isLocalhost) {
        return;
      }
      const isDynamic = url.indexOf('?') > 0;
      let name =
        isExternalUrl || isDynamic
          ? `_external/${crypto.createHash('md5').update(url).digest('hex')}`
          : normalize(stripQueryParams(url), baseUrl);
      if (name.startsWith('#') || name === '') {
        return;
      }
      if (seenUrls.has(name)) {
        // already processed
        return;
      }
      seenUrls.add(name);
      if (/\.happo-tmp\/_inlined/.test(name)) {
        if (HAPPO_DEBUG) {
          console.log(`[HAPPO] Adding inlined asset ${name}`);
        }
        archive.file(name, {
          name,
          date: FILE_CREATION_DATE,
        });
      } else {
        const fetchUrl = makeAbsolute(url, baseUrl);

        if (HAPPO_DEBUG) {
          console.log(
            `[HAPPO] Fetching asset from ${fetchUrl} — storing as ${name}`,
          );
        }

        try {
          const fetchRes = await proxiedFetch(fetchUrl, { retryCount: 5 });

          if (isDynamic || isExternalUrl) {
            // Add a file suffix so that svg images work
            name = `${name}${getFileSuffixFromMimeType(
              fetchRes.headers.get('content-type'),
            )}`;
          }

          // decode URI to make sure "%20" and such are converted to the right
          // chars
          name = decodeURI(name);
          archive.append(fetchRes.body, {
            name,
            date: FILE_CREATION_DATE,
          });
          item.name = `/${name}`;
        } catch (e) {
          console.log(`[HAPPO] Failed to fetch url ${fetchUrl}`);
          console.error(e);
        }
      }
    });

    await Promise.all(promises);
    archive.finalize();
  });
};
