/** Model type declarations for the schemas in `components.schemas`. */

import type { OpenApiDocument } from "../openapi/parse.ts";
import type { ModelNameMap } from "./naming.ts";
import {
  arrayOf,
  BOOLEAN,
  buildDocs,
  declaration,
  type DeclarationNode,
  intersection,
  literal,
  NEVER,
  NULL,
  NUMBER,
  objectOf,
  property,
  reference,
  STRING,
  type TypeNode,
  union,
  UNKNOWN,
} from "./utils.ts";

/** Prefix of a `$ref` value that points to a schema in `components.schemas`. */
const SCHEMA_REF_PREFIX = "#/components/schemas/";

/** Schema keywords that determine the generated type. */
const TYPE_KEYWORDS: ReadonlySet<string> = new Set([
  "$ref",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "enum",
  "items",
  "nullable",
  "oneOf",
  "properties",
  "required",
  "type",
]);

/** Schema keywords that annotate or validate values without changing the generated type. */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  "$comment",
  "contentEncoding",
  "contentMediaType",
  "default",
  "deprecated",
  "description",
  "discriminator",
  "example",
  "examples",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "externalDocs",
  "format",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "pattern",
  "readOnly",
  "title",
  "uniqueItems",
  "writeOnly",
  "xml",
]);

/** Schema keywords that describe the structure of a value when present without `enum` or `const`. */
const STRUCTURE_KEYWORDS = ["additionalProperties", "items", "properties", "required", "type"] as const;

/** Schema keywords that imply an object type when `type` is missing. */
const OBJECT_KEYWORDS = ["additionalProperties", "properties", "required"] as const;

/** Schema keywords that combine a list of subschemas. */
type CompositionKeyword = "allOf" | "anyOf" | "oneOf";

/**
 * Convert every schema in `components.schemas` into a model type declaration.
 *
 * @param openApiSpec The parsed OpenAPI specification.
 * @param modelNames TypeScript type names for the schemas, keyed by schema name.
 * @returns One declaration per schema, in the order of `modelNames`.
 * @throws Error If a schema cannot be converted.
 */
export function deriveModels(openApiSpec: OpenApiDocument, modelNames: ModelNameMap): DeclarationNode[] {
  const schemas = openApiSpec.components?.schemas ?? {};

  return [...modelNames].map(([schemaName, typeName]) => {
    const schema = schemas[schemaName];
    const type = convertSchema(schema, modelNames, `#/components/schemas/${schemaName}`);
    return declaration(typeName, type, schemaDocs(schema));
  });
}

/**
 * Convert a schema object into a TypeScript type.
 *
 * Every applicable keyword contributes a part of the type: references, `allOf`
 * intersections, `oneOf` and `anyOf` unions, and either the enumerated values or
 * the declared structure. The parts are intersected, and `nullable` adds `null`.
 * The schema is assumed to be structurally valid OpenAPI, so only the keywords that
 * affect the generated type are checked. This function is also used by
 * `generation/endpoints.ts` for schemas inside operations.
 *
 * @param schema The schema to convert, which may be a boolean schema in OpenAPI 3.1.
 * @param modelNames TypeScript type names for the schemas in `components.schemas`, keyed by schema name.
 * @param pointer Location of the schema.
 * @returns The TypeScript type for values matching the schema.
 * @throws Error If the schema uses an unsupported or malformed keyword.
 */
export function convertSchema(schema: unknown, modelNames: ModelNameMap, pointer: string): TypeNode {
  // OpenAPI 3.1 allows boolean schemas that accept any value or no value
  if (schema === true) {
    return UNKNOWN;
  }

  if (schema === false) {
    return NEVER;
  }

  const schemaObject = schema as Record<string, unknown>;
  validateKeywords(schemaObject, pointer);

  // Collect references and compositions of other schemas
  const parts: TypeNode[] = [];
  if (Object.hasOwn(schemaObject, "$ref")) {
    parts.push(convertReference(schemaObject["$ref"], modelNames, `${pointer}/$ref`));
  }

  if (Object.hasOwn(schemaObject, "allOf")) {
    parts.push(intersection(convertMembers(schemaObject, "allOf", modelNames, pointer)));
  }

  for (const keyword of ["oneOf", "anyOf"] as const) {
    if (Object.hasOwn(schemaObject, keyword)) {
      parts.push(union(convertMembers(schemaObject, keyword, modelNames, pointer)));
    }
  }

  // Enumerated values are more specific than the declared type, so they take precedence
  if (Object.hasOwn(schemaObject, "const")) {
    parts.push(convertLiteral(schemaObject["const"], `${pointer}/const`));
  } else if (Object.hasOwn(schemaObject, "enum")) {
    parts.push(convertEnum(schemaObject["enum"], `${pointer}/enum`));
  } else if (STRUCTURE_KEYWORDS.some((keyword) => Object.hasOwn(schemaObject, keyword))) {
    parts.push(convertStructure(schemaObject, modelNames, pointer));
  }

  // Combine the parts and apply the OpenAPI 3.0 `nullable` keyword
  const type = intersection(parts);
  return isNullable(schemaObject, pointer) ? union([type, NULL]) : type;
}

/**
 * Return the documentation comment lines describing a schema.
 *
 * The lines contain the schema description, followed by `@format`, `@default`, and
 * `@deprecated` tags where they apply. Boolean schemas have no keywords to document,
 * so they produce no lines.
 *
 * @param schema The schema to describe.
 * @returns The documentation comment lines.
 */
function schemaDocs(schema: unknown): string[] {
  if (typeof schema === "boolean") {
    return [];
  }

  const schemaObject = schema as Record<string, unknown>;
  const tags: string[] = [];
  if (typeof schemaObject["format"] === "string") {
    tags.push(`@format ${schemaObject["format"]}`);
  }

  if (Object.hasOwn(schemaObject, "default")) {
    tags.push(`@default ${JSON.stringify(schemaObject["default"])}`);
  }

  if (schemaObject["deprecated"] === true) {
    tags.push("@deprecated");
  }

  return buildDocs([schemaObject["description"]], tags);
}

/**
 * Confirm a schema only uses keywords the converter understands.
 *
 * Unsupported keywords throw an error instead of being ignored, so the generated types
 * are never silently wrong. Vendor extensions starting with `x-` are always allowed.
 *
 * @param schema The schema to check.
 * @param pointer Location of the schema.
 * @throws Error If the schema uses an unsupported keyword.
 */
function validateKeywords(schema: Record<string, unknown>, pointer: string): void {
  for (const keyword of Object.keys(schema)) {
    const isSupported = keyword.startsWith("x-") || TYPE_KEYWORDS.has(keyword) || ANNOTATION_KEYWORDS.has(keyword);
    if (!isSupported) {
      throw new Error(`Unsupported schema keyword ${JSON.stringify(keyword)} at ${pointer}/${keyword}`);
    }
  }
}

/**
 * Convert a `$ref` value into a reference to the corresponding model type.
 *
 * @param ref The reference value.
 * @param modelNames TypeScript type names for the schemas in `components.schemas`, keyed by schema name.
 * @param pointer Location of the reference value.
 * @returns A reference to the named model type.
 * @throws Error If the reference does not point to a schema in `components.schemas`.
 */
function convertReference(ref: unknown, modelNames: ModelNameMap, pointer: string): TypeNode {
  const isSchemaRef = typeof ref === "string" && ref.startsWith(SCHEMA_REF_PREFIX);
  const typeName = isSchemaRef ? modelNames.get(ref.slice(SCHEMA_REF_PREFIX.length)) : undefined;
  if (typeName === undefined) {
    throw new Error(`Reference ${JSON.stringify(ref)} does not match any schema at ${pointer}`);
  }

  return reference(typeName);
}

/**
 * Convert the subschemas listed by a composition keyword.
 *
 * @param schema The schema containing the keyword.
 * @param keyword The composition keyword.
 * @param modelNames TypeScript type names for the schemas in `components.schemas`, keyed by schema name.
 * @param pointer Location of the schema.
 * @returns The types of the subschemas, in order.
 * @throws Error If the keyword value is not a non-empty array.
 */
function convertMembers(
  schema: Record<string, unknown>,
  keyword: CompositionKeyword,
  modelNames: ModelNameMap,
  pointer: string,
): TypeNode[] {
  const membersPointer = `${pointer}/${keyword}`;
  const members = schema[keyword];
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error(`Expected a non-empty array of schemas at ${membersPointer}`);
  }

  return members.map((member, index) => convertSchema(member, modelNames, `${membersPointer}/${index}`));
}

/**
 * Convert the values of an `enum` keyword into a union of literal types.
 *
 * @param values The enumerated values.
 * @param pointer Location of the `enum` keyword.
 * @returns The union of the literal types.
 * @throws Error If the values are not a non-empty array of supported literals.
 */
function convertEnum(values: unknown, pointer: string): TypeNode {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Expected a non-empty array of values at ${pointer}`);
  }

  return union(values.map((value, index) => convertLiteral(value, `${pointer}/${index}`)));
}

/**
 * Convert an enumerated or constant value into a literal type.
 *
 * @param value The value.
 * @param pointer Location of the value.
 * @returns The literal type, or `null` for null values.
 * @throws Error If the value is not a string, finite number, boolean, or null.
 */
function convertLiteral(value: unknown, pointer: string): TypeNode {
  if (value === null) {
    return NULL;
  }

  const isLiteral = typeof value === "string" || typeof value === "boolean";
  const isFiniteNumber = typeof value === "number" && Number.isFinite(value);
  if (isLiteral || isFiniteNumber) {
    return literal(value);
  }

  throw new Error(`Only string, number, boolean, and null values are supported at ${pointer}`);
}

/**
 * Convert the structural keywords of a schema, such as `type` and `properties`.
 *
 * Each type allowed by the schema is converted separately, and the results are
 * combined into a union.
 *
 * @param schema The schema to convert.
 * @param modelNames TypeScript type names for the schemas in `components.schemas`, keyed by schema name.
 * @param pointer Location of the schema.
 * @returns The TypeScript type described by the structural keywords.
 * @throws Error If no type is allowed or a declared type is unsupported.
 */
function convertStructure(schema: Record<string, unknown>, modelNames: ModelNameMap, pointer: string): TypeNode {
  const types = readTypes(schema);
  if (types.length === 0) {
    throw new Error(`Expected at least one type at ${pointer}/type`);
  }

  return union(types.map((type) => convertType(type, schema, modelNames, pointer)));
}

/**
 * Return the JSON types allowed by a schema.
 *
 * A list of types, allowed in OpenAPI 3.1, is returned as is. When `type` is
 * missing, the types are inferred from the other structural keywords: `array` if the
 * schema defines `items`, and `object` if it defines any object keywords.
 *
 * @param schema The schema to inspect.
 * @returns The allowed type names, which are not checked to be valid.
 */
function readTypes(schema: Record<string, unknown>): readonly unknown[] {
  const declared = schema["type"];
  if (Array.isArray(declared)) {
    return declared;
  }

  if (declared !== undefined) {
    return [declared];
  }

  const inferred: string[] = [];
  if (Object.hasOwn(schema, "items")) {
    inferred.push("array");
  }

  if (OBJECT_KEYWORDS.some((keyword) => Object.hasOwn(schema, keyword))) {
    inferred.push("object");
  }

  return inferred;
}

/**
 * Convert a single JSON type name into a TypeScript type.
 *
 * @param type The JSON type name, such as `string` or `object`.
 * @param schema The schema declaring the type.
 * @param modelNames TypeScript type names for the schemas in `components.schemas`, keyed by schema name.
 * @param pointer Location of the schema.
 * @returns The TypeScript type for the JSON type.
 * @throws Error If the type name is not a JSON type.
 */
function convertType(type: unknown, schema: Record<string, unknown>, modelNames: ModelNameMap, pointer: string): TypeNode {
  switch (type) {
    case "string":
      return STRING;
    case "integer":
    case "number":
      return NUMBER;
    case "boolean":
      return BOOLEAN;
    case "null":
      return NULL;
    case "array":
      return arrayOf(convertItems(schema, modelNames, pointer));
    case "object":
      return convertObject(schema, modelNames, pointer);
    default:
      throw new Error(`Unsupported schema type ${JSON.stringify(type)} at ${pointer}/type`);
  }
}

/**
 * Convert the `items` keyword of an array schema into the array element type.
 *
 * @param schema The array schema.
 * @param modelNames TypeScript type names for the schemas in `components.schemas`, keyed by schema name.
 * @param pointer Location of the schema.
 * @returns The element type, or `unknown` if `items` is missing.
 * @throws Error If `items` is a list of schemas, which describes a tuple.
 */
function convertItems(schema: Record<string, unknown>, modelNames: ModelNameMap, pointer: string): TypeNode {
  if (!Object.hasOwn(schema, "items")) {
    return UNKNOWN;
  }

  const items = schema["items"];
  if (Array.isArray(items)) {
    throw new Error(`Tuple schemas are not supported at ${pointer}/items`);
  }

  return convertSchema(items, modelNames, `${pointer}/items`);
}

/**
 * Convert an object schema into an object type.
 *
 * Properties are optional unless they are listed in `required`. Default values do
 * not affect whether a property is optional.
 *
 * @param schema The object schema.
 * @param modelNames TypeScript type names for the schemas in `components.schemas`, keyed by schema name.
 * @param pointer Location of the schema.
 * @returns The object type.
 * @throws Error If `required` is malformed or a property schema cannot be converted.
 */
function convertObject(schema: Record<string, unknown>, modelNames: ModelNameMap, pointer: string): TypeNode {
  const required = readRequired(schema, pointer);
  const propertiesPointer = `${pointer}/properties`;
  const definitions = (schema["properties"] ?? {}) as Record<string, unknown>;

  const properties = Object.entries(definitions).map(([name, definition]) => property(
    name,
    convertSchema(definition, modelNames, `${propertiesPointer}/${name}`),
    !required.has(name),
    schemaDocs(definition),
  ));

  return objectOf(properties, convertIndexType(schema, properties.length > 0, modelNames, pointer));
}

/**
 * Return the property names listed by the `required` keyword of an object schema.
 *
 * @param schema The object schema.
 * @param pointer Location of the schema.
 * @returns The required property names.
 * @throws Error If `required` is not an array of strings.
 */
function readRequired(schema: Record<string, unknown>, pointer: string): Set<string> {
  if (!Object.hasOwn(schema, "required")) {
    return new Set();
  }

  const required = schema["required"];
  if (!Array.isArray(required) || !required.every((name) => typeof name === "string")) {
    throw new Error(`Expected an array of property names at ${pointer}/required`);
  }

  return new Set<string>(required);
}

/**
 * Convert the `additionalProperties` keyword into the index signature of an object type.
 *
 * Objects without declared properties accept any keys unless `additionalProperties`
 * is `false`. Objects with declared properties only get an index signature when
 * `additionalProperties` allows extra keys explicitly.
 *
 * @param schema The object schema.
 * @param hasProperties Whether the schema declares any properties.
 * @param modelNames TypeScript type names for the schemas in `components.schemas`, keyed by schema name.
 * @param pointer Location of the schema.
 * @returns The index signature value type, or `null` if the object has no index signature.
 * @throws Error If the `additionalProperties` schema cannot be converted.
 */
function convertIndexType(
  schema: Record<string, unknown>,
  hasProperties: boolean,
  modelNames: ModelNameMap,
  pointer: string,
): TypeNode | null {
  if (!Object.hasOwn(schema, "additionalProperties")) {
    return hasProperties ? null : UNKNOWN;
  }

  const additionalProperties = schema["additionalProperties"];
  if (additionalProperties === false) {
    return hasProperties ? null : NEVER;
  }

  const valueType = convertSchema(additionalProperties, modelNames, `${pointer}/additionalProperties`);

  // An index signature must accept the types of all declared properties, so a
  // specific value type can only be used when no properties are declared
  return hasProperties ? UNKNOWN : valueType;
}

/**
 * Return whether a schema allows `null` through the OpenAPI 3.0 `nullable` keyword.
 *
 * @param schema The schema to check.
 * @param pointer Location of the schema.
 * @returns The value of `nullable`, or `false` if it is missing.
 * @throws Error If `nullable` is not a boolean.
 */
function isNullable(schema: Record<string, unknown>, pointer: string): boolean {
  if (!Object.hasOwn(schema, "nullable")) {
    return false;
  }

  const nullable = schema["nullable"];
  if (typeof nullable !== "boolean") {
    throw new Error(`Expected a boolean at ${pointer}/nullable`);
  }

  return nullable;
}
