const md5 = require('crypto-js/md5');
const parseSrcset = require('parse-srcset');

const findCSSAssetUrls = require('./src/findCSSAssetUrls');

const CSS_ELEMENTS_SELECTOR = 'style,link[rel="stylesheet"][href]';
const COMMENT_PATTERN = /^\/\*.+\*\/$/;

function extractCSSBlocks(doc) {
  const blocks = [];
  const styleElements = doc.querySelectorAll(CSS_ELEMENTS_SELECTOR);

  styleElements.forEach(element => {
    if (element.tagName === 'LINK') {
      // <link href>
      const href = element.getAttribute('href');
      blocks.push({ key: href, href, baseUrl: element.baseURI });
    } else {
      // <style>
      const lines = Array.from(element.sheet.cssRules).map(r => r.cssText);

      // Filter out those lines that are comments (these are often source
      // mappings)
      const content = lines
        .filter(line => !COMMENT_PATTERN.test(line))
        .join('\n');

      // Create a hash so that we can dedupe equal styles
      const key = md5(content).toString();
      blocks.push({ content, key, baseUrl: element.baseURI });
    }
  });
  return blocks;
}

function defaultHandleBase64Image({ base64Url, element }) {
  // Simply make the base64Url the src of the image
  element.src = base64Url;
}

function getElementAssetUrls(
  element,
  { handleBase64Image = defaultHandleBase64Image },
) {
  const allUrls = [];
  const allElements = [element].concat(
    Array.from(element.querySelectorAll('*')),
  );
  allElements.forEach(element => {
    if (element.tagName === 'SCRIPT') {
      // skip script elements
      return;
    }
    const srcset = element.getAttribute('srcset');
    const src = element.getAttribute('src');
    const style = element.getAttribute('style');
    const base64Url = element._base64Url;
    if (base64Url) {
      handleBase64Image({ src, base64Url, element });
    }
    if (src) {
      allUrls.push({ url: src, baseUrl: element.baseURI });
    }
    if (srcset) {
      allUrls.push(
        ...parseSrcset(srcset).map(p => ({
          url: p.url,
          baseUrl: element.baseURI,
        })),
      );
    }
    if (style) {
      allUrls.push(
        ...findCSSAssetUrls(style).map(url => ({
          url,
          baseUrl: element.baseURI,
        })),
      );
    }
  });
  return allUrls.filter(({ url }) => !url.startsWith('data:'));
}

function inlineCanvases(element, { doc, responsiveInlinedCanvases = false }) {
  const canvases = [];
  if (element.tagName === 'CANVAS') {
    canvases.push(element);
  }
  canvases.push(...Array.from(element.querySelectorAll('canvas')));

  let newElement = element;
  const replacements = [];
  for (const canvas of canvases) {
    try {
      const canvasImageBase64 = canvas.toDataURL('image/png');
      if (canvasImageBase64 === 'data:,') {
        continue;
      }
      const image = doc.createElement('img');

      const url = `/.happo-tmp/_inlined/${md5(
        canvasImageBase64,
      ).toString()}.png`;
      image.src = url;
      image._base64Url = canvasImageBase64;
      const style = canvas.getAttribute('style');
      if (style) {
        image.setAttribute('style', style);
      }
      const className = canvas.getAttribute('class');
      if (className) {
        image.setAttribute('class', className);
      }
      if (responsiveInlinedCanvases) {
        image.style.width = '100%';
        image.style.height = 'auto';
      } else {
        const width = canvas.getAttribute('width');
        const height = canvas.getAttribute('height');
        image.setAttribute('width', width);
        image.setAttribute('height', height);
      }
      canvas.replaceWith(image);
      if (canvas === element) {
        // We're inlining the element. Make sure we return the modified element.
        newElement = image;
      }
      replacements.push({ from: canvas, to: image });
    } catch (e) {
      if (e.name === 'SecurityError') {
        console.warn('[HAPPO] Failed to convert tainted canvas to PNG image');
        console.warn(e);
      } else {
        throw e;
      }
    }
  }

  function cleanup() {
    for (const { from, to } of replacements) {
      to.replaceWith(from);
    }
  }
  return { element: newElement, cleanup };
}

function registerScrollPositions(doc) {
  const elements = doc.body.querySelectorAll('*');
  for (const node of elements) {
    if (node.scrollTop !== 0 || node.scrollLeft !== 0) {
      node.setAttribute(
        'data-happo-scrollposition',
        `${node.scrollTop},${node.scrollLeft}`,
      );
    }
  }
}

function extractElementAttributes(el) {
  const result = {};
  [...el.attributes].forEach(item => {
    result[item.name] = item.value;
  });
  return result;
}

function performDOMTransform({ doc, selector, transform, element }) {
  const elements = Array.from(element.querySelectorAll(selector));
  if (!elements.length) {
    return;
  }
  const replacements = [];
  for (const element of elements) {
    const replacement = transform(element, doc);
    replacements.push({ from: element, to: replacement });
    element.replaceWith(replacement);
  }
  return () => {
    for (const { from, to } of replacements) {
      to.replaceWith(from);
    }
  };
}

function takeDOMSnapshot({
  doc,
  element: originalElement,
  responsiveInlinedCanvases = false,
  transformDOM,
  handleBase64Image,
} = {}) {
  const { element, cleanup: canvasCleanup } = inlineCanvases(originalElement, {
    doc,
    responsiveInlinedCanvases,
  });

  registerScrollPositions(doc);

  const transformCleanup = transformDOM
    ? performDOMTransform({
        doc,
        element,
        ...transformDOM,
      })
    : undefined;

  element.querySelectorAll('script').forEach(scriptEl => {
    scriptEl.parentNode.removeChild(scriptEl);
  });

  doc
    .querySelectorAll('[data-happo-focus]')
    .forEach(e => e.removeAttribute('data-happo-focus'));

  if (doc.activeElement && doc.activeElement !== doc.body) {
    doc.activeElement.setAttribute('data-happo-focus', 'true');
  }

  const html = element.outerHTML;
  const assetUrls = getElementAssetUrls(element, {
    doc,
    handleBase64Image,
  });
  const cssBlocks = extractCSSBlocks(doc);
  const htmlElementAttrs = extractElementAttributes(doc.documentElement);
  const bodyElementAttrs = extractElementAttributes(doc.body);

  if (canvasCleanup) canvasCleanup();
  if (transformCleanup) transformCleanup();

  return {
    html,
    assetUrls,
    cssBlocks,
    htmlElementAttrs,
    bodyElementAttrs,
  };
}
takeDOMSnapshot.init = function noop() {
  // There used to be some code in here to set the baseUrl of all link elements.
  // But that's no longer needed (because Node.baseURI exists). We're keeping
  // the function around here however to make sure we stay backwards compatible.
};

module.exports = takeDOMSnapshot;
