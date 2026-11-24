/** Name generation for dynamic TypeScript types fromOpenApi Schemas. */

import { GenerationError } from "../errors.ts";
import { GENERATED_NAMES } from "../helpers.ts";
import { pointerTo, readComponents } from "../navigation.ts";
import type { OpenApiDocument } from "../openapi/parse.ts";

/** Maps OpenAPI schema names to TypeScript names. */
export type ModelNameMap = ReadonlyMap<string, string>;

/** Pattern matching for valid TypeScript identifiers. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Pattern matching invalid characters in TypeScript identifiers. */
const NON_IDENTIFIER_CHARACTERS = /[^A-Za-z0-9_$]+/;

/** Reserved names that cannot be used for a TypeScript types and interfaces. */
const RESERVED_TYPE_NAMES: ReadonlySet<string> = new Set([
  // Reserved words
  "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function",
  "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "null", "package",
  "private", "protected", "public", "return", "static", "super", "switch", "this", "throw",
  "true", "try", "typeof", "var", "void", "while", "with", "yield",

  // Predefined types
  "any", "bigint", "boolean", "never", "number", "object", "string", "symbol", "undefined", "unknown",
]);

/**
 * Derive a valid TypeScript type name for every schema in an OpenAPI specification.
 *
 * Schemas are read from the `components.schemas` section of the specification.
 * An error is thrown if any generated name results in a duplicate or conflicts
 * with builtin types or names reserved by the parent application.
 *
 * @param openApiSpec The parsed OpenAPI specification.
 * @returns A mapping from schema name to type name.
 * @throws GenerationError If a schema name cannot be converted or conflicts with another name.
 */
export function deriveModelNames(openApiSpec: OpenApiDocument): ModelNameMap {
  const typeNames = new Map<string, string>();
  const schemaNamesByTypeName = new Map<string, string>();

  for (const schemaName of Object.keys(readComponents(openApiSpec, "schemas")).sort()) {
    // Create type name
    const pointer = pointerTo("#/components/schemas", schemaName);
    const typeName = toIdentifier(schemaName, pointer);

    // Ensure type name does not conflict with reserved names
    if (RESERVED_TYPE_NAMES.has(typeName) || GENERATED_NAMES.has(typeName)) {
      throw new GenerationError(`Schema name ${JSON.stringify(schemaName)} conflicts with a reserved type name`, pointer);
    }

    // Ensure type name is not a duplicate
    const existingSchemaName = schemaNamesByTypeName.get(typeName);
    if (existingSchemaName !== undefined) {
      throw new GenerationError(
        `Schemas ${JSON.stringify(existingSchemaName)} and ${JSON.stringify(schemaName)} both use the type name ${JSON.stringify(typeName)}`,
        pointer,
      );
    }

    schemaNamesByTypeName.set(typeName, schemaName);
    typeNames.set(schemaName, typeName);
  }

  return typeNames;
}

/**
 * Convert an OpenAPI schema name into a valid TypeScript identifier.
 *
 * Valid identifiers are returned unchanged. Other names are split on invalid characters
 * and joined in PascalCase, with an underscore prefix if the result starts with a digit.
 *
 * @param name The OpenAPI schema name.
 * @param pointer JSON pointer to the schema location in the parent specification.
 * @returns The TypeScript identifier.
 * @throws GenerationError If the name contains no characters usable in an identifier.
 */
function toIdentifier(name: string, pointer: string): string {
  if (IDENTIFIER.test(name)) return name;

  // Convert identifiers with invalid characters to pascal case
  const identifier = name
    .split(NON_IDENTIFIER_CHARACTERS)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");

  if (identifier === "") {
    throw new GenerationError(`Schema name ${JSON.stringify(name)} cannot be converted to a type name`, pointer);
  }

  // Prefix leading digits with an underscore
  return /^\d/.test(identifier) ? `_${identifier}` : identifier;
}
