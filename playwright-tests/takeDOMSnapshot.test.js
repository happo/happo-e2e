import { test, expect } from '@playwright/test';
import http from 'http';
import handler from 'serve-handler';

let server;

async function setupPage(page) {
  await page.on('console', (msg) => {
    console.log(`Browser console [${msg.type()}]:`, msg.text());
  });
  await page.addInitScript({
    path: './browser.build.js',
  });
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    return handler(req, res, {
      public: './playwright-tests/test-assets',
    });
  });

  await new Promise((resolve) => {
    server.listen(7700, () => resolve());
  });
});

test.afterAll(async () => {
  await new Promise((resolve) => {
    server.close(() => resolve());
  });
});

test('regular elements', async ({ page }) => {
  await setupPage(page);

  await page.goto('/regular-elements');

  const snapshot = await page.evaluate(() => {
    return window.happoTakeDOMSnapshot({ doc: document, element: document.body });
  });

  expect(snapshot.html).toMatch(/<h1>Hello<\/h1>/s);
  expect(snapshot.html).toMatch(/<p>world<\/p>/s);
  expect(snapshot.html).toMatch(/<img src=".*" alt="happo-logo">/s);
  expect(snapshot.assetUrls).toEqual([
    {
      url: '/regular-elements/happo-logo.png',
      baseUrl: 'http://localhost:7700/regular-elements',
    },
  ]);
});

test('one custom element', async ({ page }) => {
  await setupPage(page);

  await page.goto('/one-custom-element');

  const snapshot = await page.evaluate(() => {
    return window.happoTakeDOMSnapshot({ doc: document, element: document.body });
  });

  expect(snapshot.html).toMatch(/<h1>Hello<\/h1>/s);
  expect(snapshot.html).toMatch(/<my-element data-color="red">/s);
  expect(snapshot.html).toMatch(
    /<happo-shadow-content style="display: none;"><style>/s,
  );
  expect(snapshot.assetUrls).toEqual([]);
});

test('nested custom elements', async ({ page }) => {
  await setupPage(page);

  await page.goto('/nested-custom-elements');

  const layoutContainer = await page.$('layout-container');
  const htmlBefore = await layoutContainer.evaluate((el) => el.outerHTML);

  const snapshot = await page.evaluate(() => {
    return window.happoTakeDOMSnapshot({ doc: document, element: document.body });
  });

  const htmlAfter = await layoutContainer.evaluate((el) => el.outerHTML);

  // The happo-shadow-content elements should not be present in the DOM after the snapshot is taken
  expect(htmlAfter).toEqual(htmlBefore);

  expect(snapshot.html).toMatch(/<layout-container data-columns="4">/s);
  expect(snapshot.html).toMatch(
    /<component-card data-title="First card" role="article">/s,
  );
  expect(snapshot.html).toMatch(
    /<component-card data-title="Second card" role="article">/s,
  );
  expect(snapshot.html).toMatch(
    /<component-card data-title="Third card" role="article">/s,
  );
  expect(snapshot.html).toMatch(
    /<component-card data-title="Fourth card" role="article">/s,
  );

  expect((snapshot.html.match(/<happo-shadow-content/gs) || []).length).toBe(5);

  expect(snapshot.assetUrls).toEqual([
    {
      url: '/nested-custom-elements/avatar.jpeg',
      baseUrl: 'http://localhost:7700/nested-custom-elements',
    },
    {
      url: '/nested-custom-elements/avatar.jpeg',
      baseUrl: 'http://localhost:7700/nested-custom-elements',
    },
    {
      url: '/nested-custom-elements/avatar.jpeg',
      baseUrl: 'http://localhost:7700/nested-custom-elements',
    },
    {
      url: '/nested-custom-elements/avatar.jpeg',
      baseUrl: 'http://localhost:7700/nested-custom-elements',
    },
  ]);
});
