// GitHub Pages serves 404.html for any path with no real file (e.g. /signup, /servers/123). This sends the visitor to
// /?/<path> so index.html can restore the real URL and app.js can route it. It lives in its own file because the site's
// Content-Security-Policy (set by Cloudflare on every response, including this 404) blocks inline scripts.
var l = window.location;
l.replace(
  l.protocol + '//' + l.hostname + (l.port ? ':' + l.port : '') + '/?/' +
  l.pathname.slice(1).replace(/&/g, '~and~') +
  (l.search ? '&' + l.search.slice(1).replace(/&/g, '~and~') : '') +
  l.hash
);
