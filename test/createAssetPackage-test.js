const assert = require('assert');
const fs = require('fs');

const createAssetPackage = require('../src/createAssetPackage');

const { SAVE_PACKAGE } = process.env;

async function wrap(func) {
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
    const pkg = await func();
    if (SAVE_PACKAGE) {
      fs.writeFileSync('test-package.zip', pkg.buffer);
    }
  } finally {
    server.close();
  }
}

async function runBasicTest() {
  await wrap(async () => {
    const pkg = await createAssetPackage([
      {
        url: '/sub%20folder/countries-bg.jpeg',
        baseUrl: 'http://localhost:3412',
      },
    ]);
    assert.equal(pkg.hash, '558b9f58b427a127a271719fb27e0141');
    return pkg;
  });
}

async function runLocalhostTest() {
  await wrap(async () => {
    const pkg = await createAssetPackage([
      {
        url: 'http://localhost:3412/sub%20folder/countries-bg.jpeg',
        baseUrl: 'http://localhost:3412',
      },
    ]);
    assert.equal(pkg.hash, '4b2ca8574350a846230c60b21bc2058f');
    return pkg;
  });
}

async function runTest() {
  await runBasicTest();
  await runLocalhostTest();
}

runTest()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
