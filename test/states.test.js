import { test } from "node:test";
import assert from "node:assert/strict";
import { skeleton, emptyState, errorState, icon } from "../public/shared.js";

test("skeleton: each kind has a status role and sr-only label", () => {
  for (const k of ["rows", "chart", "cards", "text"]) {
    const h = skeleton(k, { label: "Loading <x>" });
    assert.match(h, /role="status"/);
    assert.match(h, /<span class="sr-only">Loading &lt;x&gt;<\/span>/);
    assert.match(h, new RegExp(`skeleton-${k}`));
  }
  assert.equal((skeleton("rows", { rows: 3 }).match(/class="skeleton-row"/g) || []).length, 3);
});

test("emptyState: escapes text, link vs button action", () => {
  const h = emptyState({ icon: "star", title: "<b>No</b>", body: "Nothing", action: { label: "Go", href: "#/x" } });
  assert.match(h, /&lt;b&gt;No/);
  assert.match(h, /<a class="btn[^"]*" href="#\/x">Go<\/a>/);
  assert.match(h, /i-star/);
  const b = emptyState({ title: "t", action: { label: "Add", id: "addBtn" } });
  assert.match(b, /<button[^>]*id="addBtn">Add<\/button>/);
  assert.doesNotMatch(emptyState({ title: "t" }), /<button|<a /);
});

test("errorState: alert role, default title, retry button", () => {
  const h = errorState({ detail: "bad <thing>", retryId: "panel-1" });
  assert.match(h, /role="alert"/);
  assert.match(h, /Couldn&#39;t load this/);
  assert.match(h, /data-retry="panel-1"/);
  assert.match(h, /bad &lt;thing&gt;/);
  assert.doesNotMatch(errorState({}), /data-retry/);
});

test("icon: decorative by default, labelled on request", () => {
  assert.match(icon("bell"), /aria-hidden="true"/);
  assert.match(icon("bell"), /href="\/icons\.svg#i-bell"/);
  const l = icon("bell", { size: 24, label: "Alerts" });
  assert.match(l, /role="img" aria-label="Alerts"/);
  assert.match(l, /width="24"/);
  assert.doesNotMatch(l, /aria-hidden/);
});
