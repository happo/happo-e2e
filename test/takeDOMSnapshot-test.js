const assert = require('assert');
const jsdom = require('jsdom');

const takeDOMSnapshot = require('../takeDOMSnapshot');

function runBasicTest() {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(`
<!DOCTYPE html>
<html class="page">
  <body data-something="foo">
    <main>Hello world</main>
  </body>
</html>
  `);
  const { document: doc } = dom.window;
  const element = doc.querySelector('main');
  const snapshot = takeDOMSnapshot({ doc, element });
  assert.equal(snapshot.html, '<main>Hello world</main>');
  assert.deepEqual(snapshot.htmlElementAttrs, { class: 'page' });
  assert.deepEqual(snapshot.bodyElementAttrs, { 'data-something': 'foo' });
}

function runFocusTest() {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(`
<!DOCTYPE html>
<html>
  <body>
    <main>
      <input type="text" name="name">
      <input type="checkbox" data-happo-focus="true">
    </main>
  </body>
</html>
  `);
  const { document: doc } = dom.window;
  const element = doc.querySelector('main');
  let snapshot = takeDOMSnapshot({ doc, element });
  assert.equal(snapshot.html.trim(), `
    <main>
      <input type="text" name="name">
      <input type="checkbox">
    </main>
  `.trim());

  element.querySelector('input').focus();
  snapshot = takeDOMSnapshot({ doc, element });
  assert.equal(snapshot.html.trim(), `
    <main>
      <input type="text" name="name" data-happo-focus="true">
      <input type="checkbox">
    </main>
  `.trim());
}

function runMultiElementTest() {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(`
<!DOCTYPE html>
<html>
  <body>
  <button>Hello</button>
  <button>World</button>
  </body>
</html>
  `);
  const { document: doc } = dom.window;
  const element = doc.querySelectorAll('button');
  let snapshot = takeDOMSnapshot({ doc, element });
  assert.equal(snapshot.html.trim(), `
  <button>Hello</button>\n<button>World</button>
  `.trim());
}

function runAssetsTest() {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(`
<!DOCTYPE html>
<html>
  <body>
  <img src="/hello.png">
  <div style="background-image: url(/world.png)">
  <svg>
      <image href="../inside-svg.png"></image>
  </svg>
  </body>
</html>
  `);
  const { document: doc } = dom.window;
  const element = doc.querySelector('body');
  let snapshot = takeDOMSnapshot({ doc, element });
  assert.equal(snapshot.assetUrls.length, 3);
  assert.equal(snapshot.assetUrls[0].url, '/hello.png');
  assert.equal(snapshot.assetUrls[1].url, '/world.png');
  assert.equal(snapshot.assetUrls[2].url, '../inside-svg.png');
}

function runTest() {
  runBasicTest();
  runFocusTest();
  runMultiElementTest();
  runAssetsTest();
}

runTest();
console.log('All transformDOM tests passed');
