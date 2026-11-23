/** Unit tests for the `convertSchema` and `schemaDocs` functions. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GenerationError } from "../src/errors.ts";
import { schemaDocs } from "../src/generation/schemas.ts";
import { convert } from "./support.ts";

describe("PrimitiveTypes", () => {
  it("Verify JSON types are converted to TypeScript keyword types", () => {
    const cases: [unknown, string][] = [
      [{type: "string"}, "string"],
      [{type: "string", format: "date-time"}, "string"],
      [{type: "string", format: "binary"}, "string"],
      [{type: "integer"}, "number"],
      [{type: "number", format: "double"}, "number"],
      [{type: "boolean"}, "boolean"],
      [{type: "null"}, "null"],
    ];

    for (const [schema, expected] of cases) {
      assert.equal(convert(schema), expected, `Unexpected type for ${JSON.stringify(schema)}`);
    }
  });

  it("Verify a list of types is converted to a union", () => {
    assert.equal(convert({type: ["string", "null"]}), "string | null");
  });

  it("Verify empty and boolean schemas are converted to unknown or never", () => {
    assert.equal(convert({}), "unknown");
    assert.equal(convert(true), "unknown");
    assert.equal(convert(false), "never");
  });
});

describe("EnumsAndConstants", () => {
  it("Verify enum values are converted to a union of literals in order", () => {
    assert.equal(convert({type: "string", enum: ["PD", "AP", "DC"]}), '"PD" | "AP" | "DC"');
    assert.equal(convert({type: "integer", enum: [0, 1, 2]}), "0 | 1 | 2");
  });

  it("Verify a null enum value is converted to null", () => {
    assert.equal(convert({enum: ["OW", null]}), '"OW" | null');
  });

  it("Verify a constant is converted to a single literal", () => {
    assert.equal(convert({const: "fixed"}), '"fixed"');
  });

  it("Verify object enum values are rejected", () => {
    assert.throws(() => convert({enum: [{value: 1}]}), GenerationError);
  });
});

describe("Nullability", () => {
  it("Verify nullable schemas include null", () => {
    assert.equal(convert({type: "string", nullable: true}), "string | null");
  });

  it("Verify nullable schemas without a type remain unknown", () => {
    assert.equal(convert({nullable: true, title: "Change message"}), "unknown");
  });

  it("Verify a non-boolean nullable value is rejected", () => {
    assert.throws(() => convert({type: "string", nullable: "yes"}), /Expected a boolean/);
  });
});

describe("Composition", () => {
  const schemas = {Team: {type: "object"}, UserSummary: {type: "object"}};

  it("Verify a single allOf reference is converted to the referenced type", () => {
    const schema = {allOf: [{$ref: "#/components/schemas/UserSummary"}], readOnly: true, nullable: true};
    assert.equal(convert(schema, schemas), "UserSummary | null");
  });

  it("Verify allOf members are intersected", () => {
    const schema = {allOf: [{$ref: "#/components/schemas/Team"}, {$ref: "#/components/schemas/UserSummary"}]};
    assert.equal(convert(schema, schemas), "Team & UserSummary");
  });

  it("Verify oneOf members are combined and deduplicated", () => {
    const schema = {
      nullable: true,
      oneOf: [{type: "string", format: "email"}, {type: "string", maxLength: 0}],
    };

    assert.equal(convert(schema, schemas), "string | null");
  });

  it("Verify anyOf members are combined", () => {
    assert.equal(convert({anyOf: [{type: "string"}, {type: "integer"}]}), "string | number");
  });

  it("Verify an empty list of members is rejected", () => {
    assert.throws(() => convert({oneOf: []}), /non-empty array of schemas/);
  });
});

describe("References", () => {
  it("Verify references use the model type name", () => {
    assert.equal(convert({$ref: "#/components/schemas/pet-status"}, {"pet-status": {}}), "PetStatus");
  });

  it("Verify references to missing schemas are rejected", () => {
    assert.throws(() => convert({$ref: "#/components/schemas/Missing"}), /does not match any schema/);
  });

  it("Verify references outside components.schemas are rejected", () => {
    assert.throws(() => convert({$ref: "other.yml#/components/schemas/Team"}), /Only references to/);
    assert.throws(() => convert({$ref: "#/components/parameters/Limit"}), /Only references to/);
  });

  it("Verify nested references are rejected", () => {
    assert.throws(() => convert({$ref: "#/components/schemas/Team/properties/id"}, {Team: {}}), /Unsupported reference/);
  });
});

describe("Objects", () => {
  it("Verify properties are optional unless required", () => {
    const schema = {
      type: "object",
      properties: {id: {type: "integer"}, name: {type: "string"}},
      required: ["id"],
    };

    assert.equal(convert(schema), "{\n  id: number;\n  name?: string;\n}");
  });

  it("Verify default values do not make properties required", () => {
    const schema = {type: "object", properties: {is_active: {type: "boolean", default: true}}};
    assert.match(convert(schema), /is_active\?: boolean;/);
  });

  it("Verify property names that are not identifiers are quoted", () => {
    const schema = {type: "object", properties: {"content-type": {type: "string"}}, required: ["content-type"]};
    assert.match(convert(schema), /"content-type": string;/);
  });

  it("Verify objects without properties accept any keys", () => {
    assert.equal(convert({type: "object"}), "{ [key: string]: unknown }");
    assert.equal(convert({type: "object", additionalProperties: {}}), "{ [key: string]: unknown }");
  });

  it("Verify additionalProperties sets the index signature type", () => {
    const schema = {type: "object", additionalProperties: {type: "array", items: {type: "string"}}};
    assert.equal(convert(schema), "{ [key: string]: string[] }");
  });

  it("Verify objects that forbid additional properties without declaring any are empty", () => {
    assert.equal(convert({type: "object", additionalProperties: false}), "{ [key: string]: never }");
  });

  it("Verify objects with properties only get an index signature when one is declared", () => {
    const closed = {type: "object", properties: {id: {type: "integer"}}};
    const open = {...closed, additionalProperties: {type: "integer"}};

    assert.doesNotMatch(convert(closed), /\[key: string\]/);
    assert.match(convert(open), /\[key: string\]: unknown;/, "Index signature must accept all property types");
  });

  it("Verify the object type is inferred when type is missing", () => {
    assert.equal(convert({properties: {id: {type: "integer"}}, required: ["id"]}), "{\n  id: number;\n}");
  });

  it("Verify a malformed required list is rejected", () => {
    assert.throws(() => convert({type: "object", required: "id"}), /array of property names/);
  });
});

describe("Arrays", () => {
  it("Verify array items are converted to the element type", () => {
    assert.equal(convert({type: "array", items: {type: "integer"}}), "number[]");
  });

  it("Verify arrays without items contain unknown values", () => {
    assert.equal(convert({type: "array"}), "unknown[]");
  });

  it("Verify tuple schemas are rejected", () => {
    assert.throws(() => convert({type: "array", items: [{type: "string"}]}), /Tuple schemas/);
  });
});

describe("UnsupportedKeywords", () => {
  it("Verify keywords that change the meaning of a schema are rejected with their location", () => {
    assert.throws(
      () => convert({type: "object", properties: {id: {not: {type: "string"}}}}),
      (error: unknown) => {
        assert.ok(error instanceof GenerationError);
        assert.equal(error.pointer, "#/test/properties/id/not");
        return true;
      },
    );
  });

  it("Verify vendor extensions and annotations are accepted", () => {
    const schema = {type: "string", "x-spec-enum-id": "abc", description: "Name", maxLength: 10, readOnly: true};
    assert.equal(convert(schema), "string");
  });

  it("Verify unknown types are rejected", () => {
    assert.throws(() => convert({type: "file"}), /Unsupported schema type "file"/);
  });
});

describe("SchemaDocumentation", () => {
  it("Verify the description is followed by format, default, and deprecation tags", () => {
    const schema = {description: "The start date.", format: "date", default: "2024-01-01", deprecated: true};
    assert.deepEqual(schemaDocs(schema), [
      "The start date.",
      "",
      "@format date",
      '@default "2024-01-01"',
      "@deprecated",
    ]);
  });

  it("Verify schemas without documentation produce no lines", () => {
    assert.deepEqual(schemaDocs({type: "string"}), []);
    assert.deepEqual(schemaDocs(true), []);
  });
});
