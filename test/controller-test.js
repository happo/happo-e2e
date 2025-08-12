const { describe, it, before, after } = require('node:test');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const Controller = require('../controller');

const port = 3000;

let mockHappoConfig;
const mockHappoConfigPath = path.join(__dirname, '..', '.happo.js');

let originalEnv = {
  HAPPO_ENABLED: process.env.HAPPO_ENABLED,
  HAPPO_E2E_PORT: process.env.HAPPO_E2E_PORT,
};

let server;

before(() => {
  process.env.HAPPO_ENABLED = true;
  process.env.HAPPO_E2E_PORT = port;

  server = http.createServer((req, res) => {
    // Set proper headers
    res.setHeader('Content-Type', 'application/json');

    if (req.url.startsWith('/api/snap-requests/assets-data/')) {
      res.end(JSON.stringify({ path: '/path/to/asset', uploadedAt: '2021-01-01' }));
      return;
    }

    res.end(JSON.stringify({}));
  });
  server.listen(port);

  // Create a mock happo.js file
  const mockHappoConfigContents = `
  module.exports = {
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    project: 'test-project',
    endpoint: 'http://localhost:${port}',
    targets: {
      chrome: {
        execute: async () => ['request-id-1'],
      },
    },
  };
  `;
  fs.writeFileSync(mockHappoConfigPath, mockHappoConfigContents);
  mockHappoConfig = require(mockHappoConfigPath);
});

after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }

  // Clean up the mock config
  fs.unlinkSync(mockHappoConfigPath);

  server.close();
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

  it('registers snapshots', async () => {
    const controller = new Controller();
    await controller.init();

    // Register a test snapshot
    await controller.registerSnapshot({
      html: '<div>Test</div>',
      assetUrls: [{ url: 'http://example.com/asset.jpg' }],
      component: 'Button',
      variant: 'primary',
      cssBlocks: [],
    });

    assert.deepStrictEqual(controller.snapshots, [
      {
        bodyElementAttrs: undefined,
        component: 'Button',
        html: '<div>Test</div>',
        htmlElementAttrs: undefined,
        stylesheets: [],
        targets: ['chrome'],
        timestamp: undefined,
        variant: 'primary',
      },
    ]);
    assert.deepStrictEqual(controller.snapshotAssetUrls, [
      { url: 'http://example.com/asset.jpg' },
    ]);
    assert.deepStrictEqual(controller.allCssBlocks, []);

    await controller.finish();
  });

  it('deduplicates snapshots', async () => {
    const controller = new Controller();
    await controller.init();

    await controller.registerSnapshot({
      html: '<div>Test</div>',
      component: 'Button',
      variant: 'primary',
      cssBlocks: [],
      assetUrls: [],
    });

    // This is a different snapshot than the first one:
    await controller.registerSnapshot({
      html: '<div>Unrelated</div>',
      component: 'Foo',
      variant: 'bar',
      cssBlocks: [],
      assetUrls: [],
    });

    // This is a copy of the first snapshot:
    await controller.registerSnapshot({
      html: '<div>Test</div>',
      component: 'Button',
      variant: 'primary',
      cssBlocks: [],
      assetUrls: [],
    });

    await controller.finish();

    assert.equal(controller.snapshots.length, 2);

    assert.deepStrictEqual(controller.snapshots, [
      {
        bodyElementAttrs: undefined,
        component: 'Button',
        html: '<div>Test</div>',
        htmlElementAttrs: undefined,
        stylesheets: [],
        targets: ['chrome'],
        timestamp: undefined,
        variant: 'primary',
      },
      {
        bodyElementAttrs: undefined,
        component: 'Foo',
        html: '<div>Unrelated</div>',
        htmlElementAttrs: undefined,
        stylesheets: [],
        targets: ['chrome'],
        timestamp: undefined,
        variant: 'bar',
      },
    ]);
  });

  // https://github.com/happo/happo-e2e/issues/58
  it('gracefully handles CSS files that cannot be downloaded when there are external assets', async () => {
    const controller = new Controller();
    await controller.init();

    // Register a test snapshot
    await controller.registerSnapshot({
      html: '<div>Test</div>',
      assetUrls: [
        {
          url: 'http://example.com/asset.jpg',
          name: '/_external/b5d64099e230f05fdcdd447bf8db95b3',
        },
      ],
      component: 'Button',
      variant: 'primary',
      cssBlocks: [
        {
          key: 'http://example.com/sheet.css',
          href: 'http://example.com/sheet.css',
        },
      ],
    });

    assert.deepStrictEqual(controller.snapshots, [
      {
        bodyElementAttrs: undefined,
        component: 'Button',
        html: '<div>Test</div>',
        htmlElementAttrs: undefined,
        stylesheets: ['http://example.com/sheet.css'],
        targets: ['chrome'],
        timestamp: undefined,
        variant: 'primary',
      },
    ]);
    assert.deepStrictEqual(controller.snapshotAssetUrls, [
      {
        url: 'http://example.com/asset.jpg',
        name: '/_external/b5d64099e230f05fdcdd447bf8db95b3',
      },
    ]);
    assert.deepStrictEqual(controller.allCssBlocks, [
      { key: 'http://example.com/sheet.css', href: 'http://example.com/sheet.css' },
    ]);

    await controller.finish();
  });
});
