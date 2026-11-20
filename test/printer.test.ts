/** Unit tests for the TypeScript printer functions. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  arrayOf,
  intersection,
  literal,
  NULL,
  NUMBER,
  objectOf,
  property,
  reference,
  STRING,
  union,
  UNKNOWN,
} from "../src/nodes.ts";
import { buildDocs, printDeclaration, printDocComment, printPropertyName, printType } from "../src/printer.ts";

describe("PrintType", () => {
  it("Verify string literals are quoted and escaped", () => {
    assert.equal(printType(literal('say "hi"')), '"say \\"hi\\""');
  });

  it("Verify number and boolean literals are written as is", () => {
    assert.equal(printType(union([literal(-1), literal(true)])), "-1 | true");
  });

  it("Verify union array elements are wrapped in parentheses", () => {
    assert.equal(printType(arrayOf(union([STRING, NULL]))), "(string | null)[]");
  });

  it("Verify union members of an intersection are wrapped in parentheses", () => {
    const node = intersection([reference("A"), union([reference("B"), reference("C")])]);
    assert.equal(printType(node), "A & (B | C)");
  });

  it("Verify an object without properties is written on one line", () => {
    assert.equal(printType(objectOf([], UNKNOWN)), "{ [key: string]: unknown }");
  });

  it("Verify nested object properties are indented with documentation", () => {
    const node = objectOf([
      property("inner", objectOf([property("id", NUMBER, false, ["The record ID."])])),
      property("label", STRING, true),
    ]);

    const expected = [
      "{",
      "  inner: {",
      "    /** The record ID. */",
      "    id: number;",
      "  };",
      "  label?: string;",
      "}",
    ].join("\n");

    assert.equal(printType(node), expected);
  });

  it("Verify an index signature is written after declared properties", () => {
    const node = objectOf([property("id", NUMBER)], UNKNOWN);
    assert.equal(printType(node), "{\n  id: number;\n  [key: string]: unknown;\n}");
  });
});

describe("PrintDeclaration", () => {
  it("Verify object types are declared as interfaces", () => {
    const source = printDeclaration("Team", objectOf([property("id", NUMBER)]), ["A team."]);
    assert.equal(source, "/** A team. */\nexport interface Team {\n  id: number;\n}");
  });

  it("Verify other types are declared as type aliases", () => {
    const source = printDeclaration("Role", union([literal("OW"), literal("MB")]));
    assert.equal(source, 'export type Role = "OW" | "MB";');
  });
});

describe("PrintDocComment", () => {
  it("Verify a single line is written as a one-line comment", () => {
    assert.equal(printDocComment(["Summary."], 1), "  /** Summary. */");
  });

  it("Verify multiple lines are written as a block with blank lines preserved", () => {
    const expected = ["/**", " * Summary.", " *", " * Details.", " */"].join("\n");
    assert.equal(printDocComment(["", "Summary.", "", "Details.", ""]), expected);
  });

  it("Verify comment terminators in the text are escaped", () => {
    assert.equal(printDocComment(["Ends early */ here."]), "/** Ends early *\\/ here. */");
  });

  it("Verify no comment is written for empty documentation", () => {
    assert.equal(printDocComment(["", "  "]), "");
  });
});

describe("PrintPropertyName", () => {
  it("Verify identifiers and canonical integers are left unquoted", () => {
    assert.equal(printPropertyName("_team"), "_team");
    assert.equal(printPropertyName("200"), "200");
  });

  it("Verify other names are quoted", () => {
    assert.equal(printPropertyName("/users/"), '"/users/"');
    assert.equal(printPropertyName("2XX"), '"2XX"');
    assert.equal(printPropertyName("007"), '"007"');
  });
});

describe("BuildDocs", () => {
  it("Verify texts and tags are separated by blank lines", () => {
    assert.deepEqual(buildDocs(["Summary.", "Line one\nLine two"], ["@deprecated"]), [
      "Summary.",
      "",
      "Line one",
      "Line two",
      "",
      "@deprecated",
    ]);
  });

  it("Verify blank, repeated, and non-string texts are skipped", () => {
    assert.deepEqual(buildDocs(["Summary.", "", " Summary. ", 42, undefined]), ["Summary."]);
  });
});
