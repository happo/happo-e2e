const { URL } = require('url');

module.exports = function makeAbsolute(url, baseUrl) {
  if (url.startsWith('//')) {
    return `${baseUrl.split(':')[0]}:${url}`;
  }
  if (/^https?:/.test(url)) {
    return url;
  }
  return new URL(url, baseUrl).href;
};
