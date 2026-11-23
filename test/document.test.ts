/** Unit tests for the OpenAPI document parsing and reference resolution functions. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { componentName, parseOpenApiText, pointerTo, resolveObject } from "../src/openapi.ts";
import { GenerationError } from "../src/errors.ts";
import { buildDocument } from "./support.ts";

describe("DocumentParsing", () => {
  it("Verify YAML and JSON documents are parsed", () => {
    assert.equal(parseOpenApiText("openapi: 3.0.3\ninfo: {title: Test}\n").openapi, "3.0.3");
    assert.equal(parseOpenApiText('{"openapi": "3.1.0"}').openapi, "3.1.0");
  });

  it("Verify unsupported OpenAPI versions are rejected", () => {
    assert.throws(() => parseOpenApiText("swagger: '2.0'\n"), /Only OpenAPI 3.0 and 3.1/);
    assert.throws(() => parseOpenApiText("openapi: 4.0.0\n"), /Only OpenAPI 3.0 and 3.1/);
  });

  it("Verify malformed text and non-object documents are rejected", () => {
    assert.throws(() => parseOpenApiText("openapi: [3.0"), /not valid YAML or JSON/);
    assert.throws(() => parseOpenApiText("- openapi"), /Expected an object at #/);
  });
});

describe("JsonPointers", () => {
  it("Verify pointer segments are escaped", () => {
    assert.equal(pointerTo("#/paths", "/teams/{id}/", "get"), "#/paths/~1teams~1{id}~1/get");
    assert.equal(pointerTo("#", "a~b", 0), "#/a~0b/0");
  });

  it("Verify component names in references are unescaped and decoded", () => {
    assert.equal(componentName("#/components/schemas/a~1b~0c", "schemas", "#"), "a/b~c");
    assert.equal(componentName("#/components/schemas/Team%20Summary", "schemas", "#"), "Team Summary");
  });
});

describe("ReferenceResolution", () => {
  const document = buildDocument({
    components: {
      parameters: {
        Limit: {name: "_limit", in: "query"},
        PageSize: {$ref: "#/components/parameters/Limit"},
        Loop: {$ref: "#/components/parameters/Loop"},
      },
    },
  });

  it("Verify objects without references are returned unchanged", () => {
    const value = {name: "id", in: "path"};
    assert.deepEqual(resolveObject(document, value, "parameters", "#/test"), {value, pointer: "#/test"});
  });

  it("Verify chained references are followed to the target object", () => {
    const resolved = resolveObject(document, {$ref: "#/components/parameters/PageSize"}, "parameters", "#/test");
    assert.deepEqual(resolved, {value: {name: "_limit", in: "query"}, pointer: "#/components/parameters/Limit"});
  });

  it("Verify circular references are rejected", () => {
    assert.throws(() => resolveObject(document, {$ref: "#/components/parameters/Loop"}, "parameters", "#/test"), /Circular reference/);
  });

  it("Verify missing components are rejected with the location of the reference", () => {
    assert.throws(
      () => resolveObject(document, {$ref: "#/components/parameters/Missing"}, "parameters", "#/test"),
      (error: unknown) => error instanceof GenerationError && error.pointer === "#/test/$ref",
    );
  });

  it("Verify inherited object properties are not treated as components", () => {
    assert.throws(() => resolveObject(document, {$ref: "#/components/parameters/toString"}, "parameters", "#/test"), /does not match any component/);
  });
});
