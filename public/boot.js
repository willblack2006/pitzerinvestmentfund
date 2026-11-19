// Runs before the app's modules finish downloading, so the data the first screen needs is
// already in flight when they start. app code picks these up through api() in shared.js
// (each early request is used once, and only within a few seconds of page load).
(function () {
  var early = (window.__pifEarly = {});
  function start(path) {
    try {
      early[path] = fetch(path, { headers: { "Content-Type": "application/json", "x-pif-app": "1" }, credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("early " + r.status)); });
      early[path].catch(function () {});
      setTimeout(function () { delete early[path]; }, 8000);
    } catch (e) { /* the app will fetch it itself */ }
  }
  start("/api/auth/session");
  var route = location.hash.replace(/^#/, "") || "/";
  if (route === "/") { start("/api/positions"); start("/api/settings"); start("/api/alerts"); }
})();
