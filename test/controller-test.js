const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Controller = require('../controller');

const mockHappoConfig = {
  apiKey: 'test-api-key',
  apiSecret: 'test-api-secret',
  project: 'test-project',
  targets: {
    chrome: {
      execute: async () => ['request-id-1'],
    },
  },
};

async function runTest() {
  // Test for init
  const controller = new Controller();
  await controller.init();
  assert.strictEqual(controller.happoConfig.apiKey, mockHappoConfig.apiKey);
  assert.strictEqual(controller.happoConfig.apiSecret, mockHappoConfig.apiSecret);
  assert.strictEqual(controller.happoConfig.project, mockHappoConfig.project);
  assert.deepStrictEqual(controller.snapshots, []);
  assert.deepStrictEqual(controller.snapshotAssetUrls, []);
  assert.deepStrictEqual(controller.allCssBlocks, []);
}

async function main() {
  const mockHappoConfigPath = path.join(__dirname, '..', '.happo.js');
  try {
    // Create a mock happo.js file
    fs.writeFileSync(
      mockHappoConfigPath,
      `module.exports = ${JSON.stringify(mockHappoConfig)}`,
    );

    await runTest();

    console.log('All Controller tests passed');
  } catch (error) {
    console.error('Controller tests failed:', error);
    process.exitCode = 1;
  } finally {
    // Clean up the mock config
    fs.unlinkSync(mockHappoConfigPath);
  }
}

main();
