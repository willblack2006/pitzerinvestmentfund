const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// lib/prefs.js opens the database on require, so point it at a throwaway file first.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-portfolio-")), "test.db");
const { SCHEMA } = require("../lib/prefs");

test("holdingsColumns accepts known columns set to true or false", () => {
  assert.deepEqual(SCHEMA.holdingsColumns({ divIncome: true, weight: false }), { divIncome: true, weight: false });
  assert.deepEqual(SCHEMA.holdingsColumns({}), {});
});

test("holdingsColumns rejects unknown columns", () => {
  assert.throws(() => SCHEMA.holdingsColumns({ nope: true }), /Unknown column/);
});

test("holdingsColumns rejects non-boolean values", () => {
  assert.throws(() => SCHEMA.holdingsColumns({ weight: "yes" }), /true or false/);
  assert.throws(() => SCHEMA.holdingsColumns({ weight: 1 }), /true or false/);
});

test("holdingsColumns rejects non-objects", () => {
  for (const v of [null, [], "x", 5]) assert.throws(() => SCHEMA.holdingsColumns(v), /must be an object/);
});
