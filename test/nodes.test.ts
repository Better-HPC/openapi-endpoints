/** Unit tests for the `union` and `intersection` type node constructors. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { intersection, literal, NEVER, NULL, NUMBER, reference, STRING, union, UNKNOWN } from "../src/nodes.ts";

describe("UnionSimplification", () => {
  it("Verify nested unions are flattened", () => {
    const node = union([STRING, union([NUMBER, NULL])]);
    assert.deepEqual(node, {kind: "union", members: [STRING, NUMBER, NULL]});
  });

  it("Verify duplicate members are removed while preserving order", () => {
    const node = union([literal("b"), literal("a"), literal("b")]);
    assert.deepEqual(node, {kind: "union", members: [literal("b"), literal("a")]});
  });

  it("Verify a single member is returned unwrapped", () => {
    assert.deepEqual(union([STRING, STRING]), STRING);
  });

  it("Verify never members are dropped", () => {
    assert.deepEqual(union([NEVER, STRING]), STRING);
  });

  it("Verify an empty union is never", () => {
    assert.deepEqual(union([]), NEVER);
  });

  it("Verify a union containing unknown is unknown", () => {
    assert.deepEqual(union([STRING, UNKNOWN, NULL]), UNKNOWN);
  });
});

describe("IntersectionSimplification", () => {
  it("Verify nested intersections are flattened", () => {
    const node = intersection([reference("A"), intersection([reference("B"), reference("C")])]);
    assert.deepEqual(node, {kind: "intersection", members: [reference("A"), reference("B"), reference("C")]});
  });

  it("Verify unknown members are dropped", () => {
    assert.deepEqual(intersection([UNKNOWN, reference("A")]), reference("A"));
  });

  it("Verify an empty intersection is unknown", () => {
    assert.deepEqual(intersection([]), UNKNOWN);
  });

  it("Verify an intersection containing never is never", () => {
    assert.deepEqual(intersection([reference("A"), NEVER]), NEVER);
  });
});
