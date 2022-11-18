const assert = require('assert');
const fs = require('fs');

const createAssetPackage = require('../src/createAssetPackage');

const { SAVE_PACKAGE } = process.env;

async function runBasicTest() {
  const handler = require('serve-handler');
  const http = require('http');

  const server = http.createServer((request, response) => {
    return handler(request, response, { public: 'test-images' });
  });

  await new Promise(resolve => {
    server.listen(3412, () => {
      console.log('Running at http://localhost:3412');
      resolve();
    });
  });

  try {
    const pkg = await createAssetPackage([
      {
        url: '/sub%20folder/countries-bg.jpeg',
        baseUrl: 'http://localhost:3412',
      },
    ]);
    assert.equal(pkg.hash, 'aed32b1cc82366d461b7755d5eb3f13a');
    if (SAVE_PACKAGE) {
      fs.writeFileSync('test-package.zip', pkg.buffer);
    }
  } finally {
    server.close();
  }
}

async function runTest() {
  await runBasicTest();
}

runTest()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
