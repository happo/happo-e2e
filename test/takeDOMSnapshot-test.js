const { it } = require('node:test');
const assert = require('assert');
const jsdom = require('jsdom');

const takeDOMSnapshot = require('../takeDOMSnapshot');

it('takes a basic snapshot', () => {
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
});

it('works with data-happo-focus', () => {
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
  assert.equal(
    snapshot.html.trim(),
    `
    <main>
      <input type="text" name="name">
      <input type="checkbox">
    </main>
  `.trim(),
  );

  element.querySelector('input').focus();
  snapshot = takeDOMSnapshot({ doc, element });
  assert.equal(
    snapshot.html.trim(),
    `
    <main>
      <input type="text" name="name" data-happo-focus="true">
      <input type="checkbox">
    </main>
  `.trim(),
  );
});

it('works with multiple elements', () => {
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
  assert.equal(
    snapshot.html.trim(),
    `
  <button>Hello</button>\n<button>World</button>
  `.trim(),
  );
});

it('works with assets', () => {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(`
<!DOCTYPE html>
<html>
  <head>
    <link href="/foobar.css" rel="stylesheet" />
  </head>
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
  assert.equal(snapshot.cssBlocks.length, 1);
  assert.equal(snapshot.cssBlocks[0].href, '/foobar.css');
  assert.equal(snapshot.cssBlocks[0].baseUrl, 'about:blank');
});

it('works with radio and checkbox', () => {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(`
<!DOCTYPE html>
<html>
  <body>
    <form>
      <input type="radio" name="foo" value="a">
      <input type="radio" name="foo" value="b" checked="checked">
      <input type="radio" name="foo" value="c">
      <input type="checkbox" name="bar" checked="checked">
      <input type="checkbox" name="baz">
      <input type="checkbox" name="car">
    </form>
  </body>
</html>
  `);
  const { document: doc } = dom.window;
  doc.querySelector('input[type="radio"][value="a"]').checked = true;
  doc.querySelector('input[type="checkbox"][name="baz"]').checked = true;
  const element = doc.querySelector('form');
  const snapshot = takeDOMSnapshot({ doc, element });
  assert.equal(
    snapshot.html,
    `
    <form>
      <input type="radio" name="foo" value="a" checked="checked">
      <input type="radio" name="foo" value="b">
      <input type="radio" name="foo" value="c">
      <input type="checkbox" name="bar" checked="checked">
      <input type="checkbox" name="baz" checked="checked">
      <input type="checkbox" name="car">
    </form>
  `.trim(),
  );
});
