// Unit tests for the read-only SQL guard. Run: node --test  (from runtime/)
// No external deps — imports guard.mjs directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReadOnly, bindNamedParams, enforceLimit } from "../guard.mjs";

test("allows a plain SELECT", () => {
  assert.equal(assertReadOnly("SELECT id FROM t WHERE x = :x"), "SELECT id FROM t WHERE x = :x");
});

test("allows a WITH (CTE) query", () => {
  const q = "WITH a AS (SELECT 1) SELECT * FROM a";
  assert.equal(assertReadOnly(q), q);
});

test("allows a single trailing semicolon", () => {
  assert.equal(assertReadOnly("SELECT 1;"), "SELECT 1");
});

for (const bad of [
  "INSERT INTO t VALUES (1)",
  "UPDATE t SET x = 1",
  "DELETE FROM t",
  "DROP TABLE t",
  "ALTER TABLE t ADD c int",
  "TRUNCATE t",
  "GRANT SELECT ON t TO u",
  "CREATE TABLE t (id int)",
  "SET default_transaction_read_only = off",
]) {
  test(`rejects write/DDL: ${bad.slice(0, 24)}`, () => {
    assert.throws(() => assertReadOnly(bad), /forbidden|Only SELECT/);
  });
}

test("rejects stacked/multiple statements (injection)", () => {
  assert.throws(() => assertReadOnly("SELECT 1; DROP TABLE users"), /Multiple statements/);
});

test("rejects a non-SELECT leading statement", () => {
  assert.throws(() => assertReadOnly("EXPLAIN SELECT 1"), /Only SELECT\/WITH/);
});

test("binds named params to positional and preserves order + reuse", () => {
  const { bound, values } = bindNamedParams(
    "SELECT * FROM t WHERE a = :a AND b = :b OR a = :a",
    { a: "A", b: "B" },
    ["a", "b"],
  );
  assert.equal(bound, "SELECT * FROM t WHERE a = $1 AND b = $2 OR a = $1");
  assert.deepEqual(values, ["A", "B"]);
});

test("rejects a param not in the allow-list", () => {
  assert.throws(() => bindNamedParams("SELECT :evil", {}, ["ok"]), /Unknown parameter :evil/);
});

test("binds a missing param as NULL (optional filters)", () => {
  const { bound, values } = bindNamedParams("SELECT :a", {}, ["a"]);
  assert.equal(bound, "SELECT $1");
  assert.deepEqual(values, [null]);
});

test("enforceLimit appends LIMIT when absent", () => {
  assert.match(enforceLimit("SELECT 1", 1000), /LIMIT 1000$/);
});

test("enforceLimit leaves an existing LIMIT untouched", () => {
  assert.equal(enforceLimit("SELECT 1 LIMIT 5", 1000), "SELECT 1 LIMIT 5");
});
