#!/usr/bin/env node

const { spawn } = require('child_process');
const http = require('http');

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');

const makeRequest = require('happo.io/build/makeRequest').default;
const compareReports = require('happo.io/build/commands/compareReports').default;
const postGithubComment = require('happo.io/build/postGithubComment').default;

const loadHappoConfig = require('../src/loadHappoConfig');
const resolveEnvironment = require('../src/resolveEnvironment');

const allRequestIds = new Set();

function failWithMissingCommand() {
  console.error(`Missing command. Usage examples:\n
  happo-e2e -- cypress run
  happo-e2e -- playwright test
  happo-e2e finalize
  `);
  process.exit(1);
}

function parsePort(argv) {
  const i = argv.indexOf('--port');
  if (i === -1) {
    return 5339;
  }
  const port = argv[i + 1];
  return parseInt(port, 10);
}

function parseAllowFailures(argv) {
  return argv.indexOf('--allow-failures') > -1;
}

async function postAsyncReport({ nonce, afterSha, requestIds, link, message }) {
  const happoConfig = await loadHappoConfig();
  if (!happoConfig) {
    return;
  }
  return await makeRequest(
    {
      url: `${happoConfig.endpoint}/api/async-reports/${afterSha}`,
      method: 'POST',
      json: true,
      body: {
        requestIds,
        project: happoConfig.project,
        nonce,
        link,
        message,
      },
    },
    { ...happoConfig, retryCount: 3 },
  );
}

function requestHandler(req, res) {
  const bodyParts = [];
  req.on('data', (chunk) => {
    bodyParts.push(chunk.toString());
  });
  req.on('end', async () => {
    const potentialIds = bodyParts
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((requestId) => parseInt(requestId, 10));

    if (potentialIds.some((id) => isNaN(id))) {
      res.writeHead(400);
      res.end('invalid payload');
      return;
    }

    potentialIds.forEach((requestId) => {
      allRequestIds.add(parseInt(requestId, 10));
    });

    const { afterSha, nonce } = resolveEnvironment();
    if (nonce && potentialIds.length) {
      // Associate these snapRequests with the async report as soon as possible
      await postAsyncReport({ requestIds: potentialIds, afterSha, nonce });
    }
    res.writeHead(200);
    res.end('');
  });
}

async function finalizeAll(argv) {
  const happoConfig = await loadHappoConfig();
  if (!happoConfig) {
    return;
  }

  const { beforeSha, afterSha, link, message, nonce, notify, fallbackShas } =
    resolveEnvironment();
  if (!nonce) {
    throw new Error('[HAPPO] Missing HAPPO_NONCE environment variable');
  }
  const body = {
    project: happoConfig.project,
    nonce,
  };
  const rawSkippedExamples = yargs(argv).argv.skippedExamples;
  if (rawSkippedExamples) {
    try {
      const skippedExamples = JSON.parse(rawSkippedExamples);
      body.skippedExamples = skippedExamples;
    } catch (e) {
      console.error('Error when parsing --skippedExamples', rawSkippedExamples);
      throw e;
    }
  }

  await makeRequest(
    {
      url: `${happoConfig.endpoint}/api/async-reports/${afterSha}/finalize`,
      method: 'POST',
      json: true,
      body,
    },
    { ...happoConfig, maxTries: 3 },
  );

  if (beforeSha && beforeSha !== afterSha) {
    const compareResult = await compareReports(beforeSha, afterSha, happoConfig, {
      link,
      message,
      isAsync: true,
      notify,
      fallbackShas,
    });

    if (link && process.env.HAPPO_GITHUB_USER_CREDENTIALS) {
      // HAPPO_GITHUB_USER_CREDENTIALS is set which means that we should post
      // a comment to the PR.
      // https://docs.happo.io/docs/continuous-integration#posting-statuses-without-installing-the-happo-github-app
      await postGithubComment({
        link,
        statusImageUrl: compareResult.statusImageUrl,
        compareUrl: compareResult.compareUrl,
        githubApiUrl: happoConfig.githubApiUrl,
      });
    }
  }
}

async function finalizeHappoReport() {
  const happoConfig = await loadHappoConfig();
  if (!happoConfig) {
    return;
  }

  if (!allRequestIds.size) {
    console.log(`[HAPPO] No snapshots were recorded. Ignoring.`);
    return;
  }

  const { beforeSha, afterSha, link, message, nonce, notify, fallbackShas } =
    resolveEnvironment();
  const reportResult = await postAsyncReport({
    requestIds: [...allRequestIds],
    nonce,
    afterSha,
    link,
    message,
  });
  if (beforeSha) {
    const jobResult = await makeRequest(
      {
        url: `${happoConfig.endpoint}/api/jobs/${beforeSha}/${afterSha}`,
        method: 'POST',
        json: true,
        body: {
          project: happoConfig.project,
          link,
          message,
        },
      },
      { ...happoConfig, maxTries: 3 },
    );

    if (beforeSha !== afterSha && !nonce) {
      // If the SHAs match, there is no comparison to make. This is likely
      // running on the default branch and we are done at this point.
      // If there is a nonce, the comparison will happen when the finalize
      // command is called.
      const compareResult = await compareReports(beforeSha, afterSha, happoConfig, {
        link,
        message,
        isAsync: true,
        notify,
        fallbackShas,
      });

      if (link && process.env.HAPPO_GITHUB_USER_CREDENTIALS) {
        // HAPPO_GITHUB_USER_CREDENTIALS is set which means that we should post
        // a comment to the PR.
        // https://docs.happo.io/docs/continuous-integration#posting-statuses-without-installing-the-happo-github-app
        await postGithubComment({
          link,
          statusImageUrl: compareResult.statusImageUrl,
          compareUrl: compareResult.compareUrl,
          githubApiUrl: happoConfig.githubApiUrl,
        });
      }
    }

    console.log(`[HAPPO] ${jobResult.url}`);
  } else {
    console.log(`[HAPPO] ${reportResult.url}`);
  }
}

function startServer(port) {
  const server = http.createServer(requestHandler);
  return new Promise((resolve) => {
    server.listen(port, resolve);
  });
}

async function init(argv) {
  const dashdashIndex = argv.indexOf('--');
  if (dashdashIndex === -1) {
    const isFinalizeCommand = argv[0] === 'finalize';
    if (isFinalizeCommand) {
      await finalizeAll(argv);
      return;
    }
    failWithMissingCommand();
  }

  const commandParts = argv.slice(dashdashIndex + 1);

  if (!commandParts.length) {
    failWithMissingCommand();
  }

  const serverPort = parsePort(argv.slice(0, dashdashIndex));
  await startServer(serverPort);
  console.log(`[HAPPO] Listening on port ${serverPort}`);

  const child = spawn(commandParts[0], commandParts.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, HAPPO_E2E_PORT: serverPort },
    shell: process.platform == 'win32',
  });

  child.on('error', (e) => {
    console.error(e);
    process.exit(1);
  });

  const allowFailures = parseAllowFailures(argv.slice(0, dashdashIndex));
  child.on('close', async (code) => {
    if (code === 0 || allowFailures) {
      try {
        await finalizeHappoReport();
      } catch (e) {
        console.error('Failed to finalize Happo report', e);
        process.exit(1);
      }
    }
    process.exit(code);
  });
}

async function main(argv) {
  try {
    await init(hideBin(argv));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main(process.argv);
}

module.exports = main;
