const { describe, it, before, after } = require('node:test');
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

const mockHappoConfigPath = path.join(__dirname, '..', '.happo.js');

let originalEnv = {
  HAPPO_ENABLED: process.env.HAPPO_ENABLED,
  HAPPO_E2E_PORT: process.env.HAPPO_E2E_PORT,
};

before(() => {
  process.env.HAPPO_ENABLED = true;
  process.env.HAPPO_E2E_PORT = 3000;

  // Create a mock happo.js file
  fs.writeFileSync(
    mockHappoConfigPath,
    `module.exports = ${JSON.stringify(mockHappoConfig)}`,
  );
});

after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }

  // Clean up the mock config
  fs.unlinkSync(mockHappoConfigPath);
});

describe('Controller', () => {
  it('initializes with the correct happo config', async () => {
    const controller = new Controller();
    await controller.init();
    assert.strictEqual(controller.happoConfig.apiKey, mockHappoConfig.apiKey);
    assert.strictEqual(controller.happoConfig.apiSecret, mockHappoConfig.apiSecret);
    assert.strictEqual(controller.happoConfig.project, mockHappoConfig.project);
    assert.deepStrictEqual(controller.snapshots, []);
    assert.deepStrictEqual(controller.snapshotAssetUrls, []);
    assert.deepStrictEqual(controller.allCssBlocks, []);
  });
});
