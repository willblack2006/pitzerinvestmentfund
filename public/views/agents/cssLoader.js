// Links a stylesheet once. WS1's public/css/index.css @imports trace.css too; this keeps the
// pages styled when they load before (or without) that.
export function ensureCss(href) {
  if ([...document.styleSheets].some((s) => s.href && s.href.endsWith(href))) return;
  if (document.querySelector(`link[data-ws8="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = href; l.dataset.ws8 = href;
  document.head.appendChild(l);
}
