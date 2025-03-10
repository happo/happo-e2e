const recordedCSSSymbol = Symbol('recordedCssRules');
const hasBrokenIndexesSymbol = Symbol('hasBrokenIndexes');

// Helper to ensure our custom recorded array exists on the sheet.
function ensureRecord(sheet) {
  if (!sheet[recordedCSSSymbol]) {
    sheet[recordedCSSSymbol] = [];
  }
}

function displayError(message) {
  console.error(message);

  const el = document.createElement('div');
  el.setAttribute(
    'style',
    `
    position: fixed;
    display: flex;
    align-items: center;
    justify-content: center;
    top: 0;
    left: 0;
    bottom: 0;
    right: 0;
    padding: 30px;
    background: red;
    font-weight: bold;
    color: white;
    z-index: 1000;
    font-family: monospace;
  `,
  );
  const inner = document.createElement('div');
  inner.textContent = message;
  el.appendChild(inner);
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(el);
  });
}

module.exports = function applyConstructedStylesPatch() {
  if (typeof CSSStyleSheet === 'undefined') {
    console.error('CSSStyleSheet is not supported in this browser');
    return;
  }
  // Patch insertRule to record each rule string.
  const originalInsertRule = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function (rule, index = 0) {
    ensureRecord(this);

    if (this[hasBrokenIndexesSymbol] && index) {
      displayError(
        'CSSStyleSheet.prototype.insertRule with a non-zero index does not work with Happo after first having called replace/replaceSync. Reach out to support@happo.io if you need help with this.',
      );
      return originalInsertRule.call(this, rule, index);
    }

    // If index is not provided or invalid, default to appending.
    if (index === undefined || index < 0 || index > this[recordedCSSSymbol].length) {
      this[recordedCSSSymbol].push(rule);
    } else {
      this[recordedCSSSymbol].splice(index, 0, rule);
    }
    return originalInsertRule.call(this, rule, index);
  };

  const originalAddRule = CSSStyleSheet.prototype.addRule;
  CSSStyleSheet.prototype.addRule = function (selector, styleBlock, index) {
    ensureRecord(this);
    if (this[hasBrokenIndexesSymbol] && index) {
      displayError(
        'CSSStyleSheet.prototype.addRule with a non-zero index does not work with Happo after first having called replace/replaceSync. Reach out to support@happo.io if you need help with this.',
      );
      return originalAddRule.call(this, selector, styleBlock, index);
    }

    const rule = `${selector} { ${styleBlock} }`;
    if (index === undefined || index < 0 || index > this[recordedCSSSymbol].length) {
      this[recordedCSSSymbol].push(rule);
    } else {
      this[recordedCSSSymbol].splice(index, 0, rule);
    }
    return originalAddRule.call(this, selector, styleBlock, index);
  };

  // Patch deleteRule so that removed rules are taken out of our record.
  const originalDeleteRule = CSSStyleSheet.prototype.deleteRule;
  CSSStyleSheet.prototype.deleteRule = function (index) {
    ensureRecord(this);
    if (this[hasBrokenIndexesSymbol]) {
      displayError(
        'CSSStyleSheet.prototype.deleteRule does not work with Happo after first having called replace/replaceSync. Reach out to support@happo.io if you need help with this.',
      );
    } else if (index >= 0 && index < this[recordedCSSSymbol].length) {
      this[recordedCSSSymbol].splice(index, 1);
    }
    return originalDeleteRule.call(this, index);
  };

  const originalRemoveRule = CSSStyleSheet.prototype.removeRule;
  CSSStyleSheet.prototype.removeRule = function (index) {
    ensureRecord(this);
    if (this[hasBrokenIndexesSymbol]) {
      displayError(
        'CSSStyleSheet.prototype.removeRule does not work with Happo after first having called replace/replaceSync. Reach out to support@happo.io if you need help with this.',
      );
    } else if (index >= 0 && index < this[recordedCSSSymbol].length) {
      this[recordedCSSSymbol].splice(index, 1);
    }
    return originalRemoveRule.call(this, index);
  };

  // Patch replaceSync to capture the new CSS text.
  const originalReplaceSync = CSSStyleSheet.prototype.replaceSync;
  CSSStyleSheet.prototype.replaceSync = function (text) {
    this[recordedCSSSymbol] = text.split('\n').map((rule) => rule.trim());
    this[hasBrokenIndexesSymbol] = true;
    return originalReplaceSync.call(this, text);
  };

  // Patch replace (the asynchronous version) similarly.
  const originalReplace = CSSStyleSheet.prototype.replace;
  CSSStyleSheet.prototype.replace = function (text) {
    const sheet = this;
    return originalReplace.call(sheet, text).then(function (result) {
      sheet[recordedCSSSymbol] = text.split('\n').map((rule) => rule.trim());
      sheet[hasBrokenIndexesSymbol] = true;
      return result;
    });
  };
};

module.exports.recordedCSSSymbol = recordedCSSSymbol;
