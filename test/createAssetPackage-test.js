const { describe, it, beforeEach, afterEach } = require('node:test');
const http = require('http');
const assert = require('assert');

const handler = require('serve-handler');

const createAssetPackage = require('../src/createAssetPackage');

let server;

beforeEach(async () => {
  server = http.createServer((request, response) => {
    return handler(request, response, { public: 'test-fixtures' });
  });

  await new Promise((resolve) => {
    server.listen(3412, () => {
      console.log('Running at http://localhost:3412');
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

describe('createAssetPackage', () => {
  it('creates an asset package', async () => {
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
  });
});
