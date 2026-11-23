/**
 * Conversion of OpenAPI schema objects into TypeScript types.
 *
 * The converter supports the parts of OpenAPI 3.0 and 3.1 schemas used to describe
 * JSON data, which covers the output of common generators such as drf-spectacular.
 * Keywords that would change the meaning of a schema but are not supported raise an
 * error instead of being ignored, so unsupported documents fail loudly rather than
 * producing incorrect types. Keywords that only annotate or validate values, such as
 * `description` or `maxLength`, do not affect the generated type.
 */

import { GenerationError } from "../errors.ts";
import { componentName, expectRecord, hasOwn, isRecord, type OpenApiDocument, pointerTo } from "../navigation.ts";
import { arrayOf, BOOLEAN, buildDocs, intersection, literal, NEVER, NULL, NUMBER, objectOf, property, reference, STRING, type TypeNode, union, UNKNOWN, } from "../nodes.ts";

/** Shared state used while converting an OpenAPI document. */
export interface GeneratorContext {
  /** The document being converted. */
  readonly document: OpenApiDocument;

  /** TypeScript type names for the schemas in `components.schemas`, keyed by schema name. */
  readonly modelNames: ReadonlyMap<string, string>;
}

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

/** Schema keywords that combine a list of subschemas. */
type CompositionKeyword = "allOf" | "anyOf" | "oneOf";

/**
 * Convert a schema object into a TypeScript type.
 *
 * Every applicable keyword contributes a part of the type: references, `allOf`
 * intersections, `oneOf` and `anyOf` unions, and either the enumerated values or
 * the declared structure. The parts are intersected, and `nullable` adds `null`.
 *
 * @param schema The schema to convert, which may be a boolean schema in OpenAPI 3.1.
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the schema.
 * @returns The TypeScript type for values matching the schema.
 * @throws GenerationError If the schema uses an unsupported or malformed keyword.
 */
export function convertSchema(schema: unknown, context: GeneratorContext, pointer: string): TypeNode {
  // OpenAPI 3.1 allows boolean schemas that accept any value or no value
  if (schema === true) return UNKNOWN;
  if (schema === false) return NEVER;

  const object = expectRecord(schema, pointer);
  validateKeywords(object, pointer);

  const parts: TypeNode[] = [];
  if (hasOwn(object, "$ref")) {
    parts.push(convertReference(object["$ref"], context, pointerTo(pointer, "$ref")));
  }

  if (hasOwn(object, "allOf")) {
    parts.push(intersection(convertMembers(object, "allOf", context, pointer)));
  }

  for (const keyword of ["oneOf", "anyOf"] as const) {
    if (hasOwn(object, keyword)) {
      parts.push(union(convertMembers(object, keyword, context, pointer)));
    }
  }

  // Enumerated values are more specific than the declared type, so they take precedence
  if (hasOwn(object, "const")) {
    parts.push(convertLiteral(object["const"], pointerTo(pointer, "const")));
  } else if (hasOwn(object, "enum")) {
    parts.push(convertEnum(object["enum"], pointerTo(pointer, "enum")));
  } else if (STRUCTURE_KEYWORDS.some((keyword) => hasOwn(object, keyword))) {
    parts.push(convertStructure(object, context, pointer));
  }

  const node = intersection(parts);
  return isNullable(object, pointer) ? union([node, NULL]) : node;
}

/**
 * Return the documentation comment lines describing a schema.
 *
 * @param schema The schema to describe.
 * @returns The schema description followed by `@format`, `@default`, and `@deprecated` tags where applicable.
 */
export function schemaDocs(schema: unknown): string[] {
  if (!isRecord(schema)) return [];

  const tags: string[] = [];
  if (typeof schema["format"] === "string") tags.push(`@format ${schema["format"]}`);
  if (hasOwn(schema, "default")) tags.push(`@default ${JSON.stringify(schema["default"])}`);
  if (schema["deprecated"] === true) tags.push("@deprecated");

  return buildDocs([schema["description"]], tags);
}

/**
 * Confirm a schema only uses keywords the converter understands.
 *
 * Vendor extensions starting with `x-` are always allowed.
 *
 * @param schema The schema to check.
 * @param pointer JSON pointer to the schema.
 * @throws GenerationError If the schema uses an unsupported keyword.
 */
function validateKeywords(schema: Record<string, unknown>, pointer: string): void {
  for (const keyword of Object.keys(schema)) {
    if (keyword.startsWith("x-") || TYPE_KEYWORDS.has(keyword) || ANNOTATION_KEYWORDS.has(keyword)) continue;
    throw new GenerationError(`Unsupported schema keyword ${JSON.stringify(keyword)}`, pointerTo(pointer, keyword));
  }
}

/**
 * Convert a `$ref` value into a reference to the corresponding model type.
 *
 * @param ref The reference value.
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the reference value.
 * @returns A reference to the named model type.
 * @throws GenerationError If the reference does not point to a schema in `components.schemas`.
 */
function convertReference(ref: unknown, context: GeneratorContext, pointer: string): TypeNode {
  const name = componentName(ref, "schemas", pointer);
  const identifier = context.modelNames.get(name);
  if (identifier === undefined) {
    throw new GenerationError(`Reference ${JSON.stringify(ref)} does not match any schema`, pointer);
  }

  return reference(identifier);
}

/**
 * Convert the subschemas listed by a composition keyword.
 *
 * @param schema The schema containing the keyword.
 * @param keyword The composition keyword.
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the schema.
 * @returns The types of the subschemas, in order.
 * @throws GenerationError If the keyword value is not a non-empty array.
 */
function convertMembers(
  schema: Record<string, unknown>,
  keyword: CompositionKeyword,
  context: GeneratorContext,
  pointer: string,
): TypeNode[] {
  const membersPointer = pointerTo(pointer, keyword);
  const members = schema[keyword];
  if (!Array.isArray(members) || members.length === 0) {
    throw new GenerationError("Expected a non-empty array of schemas", membersPointer);
  }

  return members.map((member, index) => convertSchema(member, context, pointerTo(membersPointer, index)));
}

/**
 * Convert the values of an `enum` keyword into a union of literal types.
 *
 * @param values The enumerated values.
 * @param pointer JSON pointer to the `enum` keyword.
 * @returns The union of the literal types.
 * @throws GenerationError If the values are not a non-empty array of supported literals.
 */
function convertEnum(values: unknown, pointer: string): TypeNode {
  if (!Array.isArray(values) || values.length === 0) {
    throw new GenerationError("Expected a non-empty array of values", pointer);
  }

  return union(values.map((value, index) => convertLiteral(value, pointerTo(pointer, index))));
}

/**
 * Convert an enumerated or constant value into a literal type.
 *
 * @param value The value.
 * @param pointer JSON pointer to the value.
 * @returns The literal type, or `null` for null values.
 * @throws GenerationError If the value is not a string, finite number, boolean, or null.
 */
function convertLiteral(value: unknown, pointer: string): TypeNode {
  if (value === null) return NULL;
  if (typeof value === "string" || typeof value === "boolean") return literal(value);
  if (typeof value === "number" && Number.isFinite(value)) return literal(value);
  throw new GenerationError("Only string, number, boolean, and null values are supported", pointer);
}

/**
 * Convert the structural keywords of a schema, such as `type` and `properties`.
 *
 * When `type` is missing, the type is inferred from the other structural keywords.
 * A list of types, allowed in OpenAPI 3.1, produces a union.
 *
 * @param schema The schema to convert.
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the schema.
 * @returns The TypeScript type described by the structural keywords.
 * @throws GenerationError If a declared type is unsupported.
 */
function convertStructure(schema: Record<string, unknown>, context: GeneratorContext, pointer: string): TypeNode {
  const declared = schema["type"];
  const types: readonly unknown[] = Array.isArray(declared)
    ? declared
    : declared === undefined ? inferTypes(schema) : [declared];

  if (types.length === 0) {
    throw new GenerationError("Expected at least one type", pointerTo(pointer, "type"));
  }

  return union(types.map((type) => convertType(type, schema, context, pointer)));
}

/**
 * Infer the types allowed by a schema that has structural keywords but no `type`.
 *
 * @param schema The schema to inspect.
 * @returns `array` if the schema defines `items`, and `object` if it defines object keywords.
 */
function inferTypes(schema: Record<string, unknown>): string[] {
  const types: string[] = [];
  if (hasOwn(schema, "items")) types.push("array");
  if (["additionalProperties", "properties", "required"].some((keyword) => hasOwn(schema, keyword))) {
    types.push("object");
  }

  return types;
}

/**
 * Convert a single JSON type name into a TypeScript type.
 *
 * @param type The JSON type name, such as `string` or `object`.
 * @param schema The schema declaring the type.
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the schema.
 * @returns The TypeScript type for the JSON type.
 * @throws GenerationError If the type name is not a JSON type.
 */
function convertType(type: unknown, schema: Record<string, unknown>, context: GeneratorContext, pointer: string): TypeNode {
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
      return arrayOf(convertItems(schema, context, pointer));
    case "object":
      return convertObject(schema, context, pointer);
    default:
      throw new GenerationError(`Unsupported schema type ${JSON.stringify(type)}`, pointerTo(pointer, "type"));
  }
}

/**
 * Convert the `items` keyword of an array schema into the array element type.
 *
 * @param schema The array schema.
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the schema.
 * @returns The element type, or `unknown` if `items` is missing.
 * @throws GenerationError If `items` is a list of schemas, which describes a tuple.
 */
function convertItems(schema: Record<string, unknown>, context: GeneratorContext, pointer: string): TypeNode {
  if (!hasOwn(schema, "items")) return UNKNOWN;

  const items = schema["items"];
  if (Array.isArray(items)) {
    throw new GenerationError("Tuple schemas are not supported", pointerTo(pointer, "items"));
  }

  return convertSchema(items, context, pointerTo(pointer, "items"));
}

/**
 * Convert an object schema into an object type.
 *
 * Properties are optional unless they are listed in `required`. Default values do
 * not affect whether a property is optional.
 *
 * @param schema The object schema.
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the schema.
 * @returns The object type.
 * @throws GenerationError If `properties` or `required` is malformed.
 */
function convertObject(schema: Record<string, unknown>, context: GeneratorContext, pointer: string): TypeNode {
  const required = readRequired(schema, pointer);
  const propertiesPointer = pointerTo(pointer, "properties");
  const definitions = hasOwn(schema, "properties") ? expectRecord(schema["properties"], propertiesPointer) : {};

  const properties = Object.entries(definitions).map(([name, definition]) => property(
    name,
    convertSchema(definition, context, pointerTo(propertiesPointer, name)),
    !required.has(name),
    schemaDocs(definition),
  ));

  return objectOf(properties, convertIndexType(schema, properties.length > 0, context, pointer));
}

/**
 * Return the property names listed by the `required` keyword of an object schema.
 *
 * @param schema The object schema.
 * @param pointer JSON pointer to the schema.
 * @returns The required property names.
 * @throws GenerationError If `required` is not an array of strings.
 */
function readRequired(schema: Record<string, unknown>, pointer: string): Set<string> {
  if (!hasOwn(schema, "required")) return new Set();

  const required = schema["required"];
  if (!Array.isArray(required) || !required.every((name) => typeof name === "string")) {
    throw new GenerationError("Expected an array of property names", pointerTo(pointer, "required"));
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
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the schema.
 * @returns The index signature value type, or `null` if the object has no index signature.
 */
function convertIndexType(
  schema: Record<string, unknown>,
  hasProperties: boolean,
  context: GeneratorContext,
  pointer: string,
): TypeNode | null {
  if (!hasOwn(schema, "additionalProperties")) return hasProperties ? null : UNKNOWN;

  const value = schema["additionalProperties"];
  if (value === false) return hasProperties ? null : NEVER;

  const valueType = convertSchema(value, context, pointerTo(pointer, "additionalProperties"));

  // An index signature must accept the types of all declared properties, so a
  // specific value type can only be used when no properties are declared
  return hasProperties ? UNKNOWN : valueType;
}

/**
 * Return whether a schema allows `null` through the OpenAPI 3.0 `nullable` keyword.
 *
 * @param schema The schema to check.
 * @param pointer JSON pointer to the schema.
 * @returns The value of `nullable`, or `false` if it is missing.
 * @throws GenerationError If `nullable` is not a boolean.
 */
function isNullable(schema: Record<string, unknown>, pointer: string): boolean {
  if (!hasOwn(schema, "nullable")) return false;

  const nullable = schema["nullable"];
  if (typeof nullable !== "boolean") {
    throw new GenerationError("Expected a boolean", pointerTo(pointer, "nullable"));
  }

  return nullable;
}
