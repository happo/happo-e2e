const { describe, it, before, after } = require('node:test');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert');
const fs = require('node:fs');

const happoE2E = require('../bin/happo-e2e');

const tmpHappoConfig = path.join(os.tmpdir(), '.happo.js');
before(() => {
  process.env.HAPPO_CONFIG_FILE = tmpHappoConfig;
});

after(() => {
  fs.unlinkSync(tmpHappoConfig);
  process.exitCode = undefined;
});

function writeHappoConfig(config) {
  fs.writeFileSync(
    tmpHappoConfig,
    `module.exports = ${JSON.stringify(config, null, 2)}`,
  );
}

describe('finalize command', () => {
  it('exits with code 1 if apiKey is not set', async () => {
    writeHappoConfig({});

    await happoE2E(['happo-e2e', '--', 'finalize']);

    assert.strictEqual(process.exitCode, 1);
  });
});
