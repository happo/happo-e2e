// Create a new constructed stylesheet
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  p {
    color: red;
  }
`);

// Apply the constructed stylesheet to the document
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
