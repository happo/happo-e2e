const { describe, it } = require('node:test');
const assert = require('assert');
const fs = require('fs');

const createAssetPackage = require('../src/createAssetPackage');

const { SAVE_PACKAGE } = process.env;

async function wrap(func) {
  const handler = require('serve-handler');
  const http = require('http');

  const server = http.createServer((request, response) => {
    return handler(request, response, { public: 'test-fixtures' });
  });

  await new Promise((resolve) => {
    server.listen(3412, () => {
      console.log('Running at http://localhost:3412');
      resolve();
    });
  });

  try {
    const pkg = await func();
    if (SAVE_PACKAGE) {
      fs.writeFileSync('test-package.zip', pkg.buffer);
    }
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

describe('createAssetPackage', () => {
  it('creates an asset package', async () => {
    await wrap(async () => {
      const pkg = await createAssetPackage([
        {
          url: '/sub%20folder/countries-bg.jpeg',
          baseUrl: 'http://localhost:3412',
        },
        {
          url: 'http://localhost:3412/sub%20folder/countries-bg.jpeg',
          baseUrl: 'http://localhost:3412',
        },
        {
          url: 'http://localhost:3412/foo.html',
          baseUrl: 'http://localhost:3412',
        },
      ]);
      assert.equal(pkg.hash, '898862aad00d429b73f57256332a6ee1');
      return pkg;
    });
  });
});
