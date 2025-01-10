const md5 = require('crypto-js/md5');
const parseSrcset = require('parse-srcset');

const findCSSAssetUrls = require('./src/findCSSAssetUrls');

const CSS_ELEMENTS_SELECTOR = 'style,link[rel="stylesheet"][href]';
const COMMENT_PATTERN = /^\/\*.+\*\/$/;

function extractCSSBlocks(doc) {
  const blocks = [];
  const styleElements = doc.querySelectorAll(CSS_ELEMENTS_SELECTOR);

  styleElements.forEach((element) => {
    if (element.closest('happo-shadow-content')) {
      // Skip if element is inside a happo-shadow-content element. These need to
      // be scoped to the shadow root and cannot be part of the global styles.
      return;
    }
    if (element.tagName === 'LINK') {
      // <link href>
      const href = element.href || element.getAttribute('href');
      blocks.push({ key: href, href, baseUrl: element.baseURI });
    } else {
      // <style>
      const lines = Array.from(element.sheet.cssRules).map((r) => r.cssText);

      // Filter out those lines that are comments (these are often source
      // mappings)
      const content = lines.filter((line) => !COMMENT_PATTERN.test(line)).join('\n');

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
  const allElements = [element].concat(Array.from(element.querySelectorAll('*')));
  allElements.forEach((element) => {
    if (element.tagName === 'SCRIPT') {
      // skip script elements
      return;
    }
    const srcset = element.getAttribute('srcset');
    const src = element.getAttribute('src');
    const imageHref =
      element.tagName.toLowerCase() === 'image' && element.getAttribute('href');
    const linkHref =
      element.tagName.toLowerCase() === 'link' &&
      element.getAttribute('rel') === 'stylesheet' &&
      element.getAttribute('href');

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
        ...parseSrcset(srcset).map((p) => ({
          url: p.url,
          baseUrl: element.baseURI,
        })),
      );
    }
    if (style) {
      allUrls.push(
        ...findCSSAssetUrls(style).map((url) => ({
          url,
          baseUrl: element.baseURI,
        })),
      );
    }
    if (imageHref) {
      allUrls.push({ url: imageHref, baseUrl: element.baseURI });
    }
    if (linkHref) {
      allUrls.push({ url: linkHref, baseUrl: element.baseURI });
    }
  });
  return allUrls.filter(({ url }) => !url.startsWith('data:'));
}

function copyStyles(sourceElement, targetElement) {
  const computedStyle = window.getComputedStyle(sourceElement);

  for (let i = 0; i < computedStyle.length; i++) {
    const key = computedStyle[i];
    const value = computedStyle.getPropertyValue(key);
    targetElement.style.setProperty(key, value);
  }
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

      const url = `/.happo-tmp/_inlined/${md5(canvasImageBase64).toString()}.png`;
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
        copyStyles(canvas, image);
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

function registerCheckedInputs(doc) {
  const elements = doc.body.querySelectorAll(
    'input[type="checkbox"], input[type="radio"]',
  );
  for (const node of elements) {
    if (node.checked) {
      node.setAttribute('checked', 'checked');
    } else {
      node.removeAttribute('checked');
    }
  }
}

function extractElementAttributes(el) {
  const result = {};
  [...el.attributes].forEach((item) => {
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

function transformToElementArray(elements, doc) {
  // Check if 'elements' is already an array
  if (Array.isArray(elements)) {
    return elements;
  }
  // Check if 'elements' is a NodeList
  if (elements instanceof doc.defaultView.NodeList) {
    return Array.from(elements);
  }
  // Check if 'elements' is a single HTMLElement
  if (elements instanceof doc.defaultView.HTMLElement) {
    return [elements];
  }

  if (typeof elements.length !== 'undefined') {
    return elements;
  }

  return [elements];
}

/**
 * Injects all shadow roots from the given element.
 *
 * @param {HTMLElement} element
 */
function inlineShadowRoots(element) {
  const elements = [element];

  const elementsToProcess = [];
  while (elements.length) {
    const element = elements.shift();
    if (element.shadowRoot) {
      elementsToProcess.unshift(element); // LIFO so that leaf nodes are processed first
    }
    elements.unshift(...element.children); // LIFO so that leaf nodes are processed first
  }

  for (const element of elementsToProcess) {
    const hiddenElement = document.createElement('happo-shadow-content');
    hiddenElement.style.display = 'none';

    // Add adopted stylesheets as <style> elements
    for (const styleSheet of element.shadowRoot.adoptedStyleSheets) {
      const styleElement = document.createElement('style');
      styleElement.setAttribute('data-happo-inlined', 'true');
      const rules = Array.from(styleSheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n');
      styleElement.textContent = rules;
      hiddenElement.appendChild(styleElement);
    }

    hiddenElement.innerHTML += element.shadowRoot.innerHTML;
    element.appendChild(hiddenElement);
  }
}

function findSvgElementsWithSymbols(element) {
  return [...element.ownerDocument.querySelectorAll('svg')].filter((svg) =>
    svg.querySelector('symbol'),
  );
}

function takeDOMSnapshot({
  doc,
  element: oneOrMoreElements,
  responsiveInlinedCanvases = false,
  transformDOM,
  handleBase64Image,
} = {}) {
  const allElements = transformToElementArray(oneOrMoreElements, doc);
  const htmlParts = [];
  const assetUrls = [];
  for (const originalElement of allElements) {
    const { element, cleanup: canvasCleanup } = inlineCanvases(originalElement, {
      doc,
      responsiveInlinedCanvases,
    });

    registerScrollPositions(doc);
    registerCheckedInputs(doc);

    const transformCleanup = transformDOM
      ? performDOMTransform({
          doc,
          element,
          ...transformDOM,
        })
      : undefined;

    element.querySelectorAll('script').forEach((scriptEl) => {
      scriptEl.parentNode.removeChild(scriptEl);
    });

    doc
      .querySelectorAll('[data-happo-focus]')
      .forEach((e) => e.removeAttribute('data-happo-focus'));

    if (doc.activeElement && doc.activeElement !== doc.body) {
      doc.activeElement.setAttribute('data-happo-focus', 'true');
    }

    inlineShadowRoots(element);

    assetUrls.push(
      ...getElementAssetUrls(element, {
        doc,
        handleBase64Image,
      }),
    );

    htmlParts.push(element.outerHTML);

    const svgElementsWithSymbols = findSvgElementsWithSymbols(element);
    for (const svgElement of svgElementsWithSymbols) {
      htmlParts.push(`<div style="display: none;">${svgElement.outerHTML}</div>`);
    }
    if (canvasCleanup) canvasCleanup();
    if (transformCleanup) transformCleanup();
  }

  const cssBlocks = extractCSSBlocks(doc);
  const htmlElementAttrs = extractElementAttributes(doc.documentElement);
  const bodyElementAttrs = extractElementAttributes(doc.body);

  // Remove our shadow content elements so that they don't affect the page
  doc.querySelectorAll('happo-shadow-content').forEach((e) => e.remove());

  return {
    html: htmlParts.join('\n'),
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
