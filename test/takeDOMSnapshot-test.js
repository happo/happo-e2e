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

function runTest() {
  runBasicTest();
  runFocusTest();
}

runTest();
console.log('All transformDOM tests passed');
