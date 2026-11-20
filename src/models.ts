/**
 * Model type declarations for the schemas in `components.schemas`.
 *
 * Each schema becomes an exported interface or type alias named after the schema, so
 * other generated types can refer to models by name and applications can import them
 * directly. Schema names that are not valid TypeScript identifiers are converted to
 * PascalCase, and names that would conflict with each other, with reserved words, or
 * with other generated declarations raise an error.
 */

import { pointerTo } from "./document.ts";
import { GenerationError } from "./errors.ts";
import { printDeclaration } from "./printer.ts";
import { convertSchema, schemaDocs, type GeneratorContext } from "./schemas.ts";

/** Pattern matching names that are valid TypeScript identifiers. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Pattern matching runs of characters that cannot appear in a TypeScript identifier. */
const NON_IDENTIFIER_CHARACTERS = /[^A-Za-z0-9_$]+/;

/** Names that cannot be used for a TypeScript interface or type alias. */
const RESERVED_TYPE_NAMES: ReadonlySet<string> = new Set([
  // Reserved words
  "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
  "implements", "import", "in", "instanceof", "interface", "let", "new", "null", "package",
  "private", "protected", "public", "return", "static", "super", "switch", "this", "throw",
  "true", "try", "typeof", "var", "void", "while", "with", "yield",

  // Predefined type names
  "any", "bigint", "boolean", "never", "number", "object", "string", "symbol", "undefined", "unknown",
]);

/**
 * Choose a TypeScript type name for every schema in `components.schemas`.
 *
 * @param schemas The `components.schemas` object.
 * @param reservedNames Names used by other generated declarations, which schemas may not use.
 * @returns The type name for each schema, keyed by schema name and sorted by schema name.
 * @throws GenerationError If a schema name cannot be converted or conflicts with another name.
 */
export function createModelNames(
  schemas: Record<string, unknown>,
  reservedNames: ReadonlySet<string>,
): Map<string, string> {
  const names = new Map<string, string>();
  const owners = new Map<string, string>();

  for (const name of Object.keys(schemas).sort()) {
    const pointer = pointerTo("#/components/schemas", name);
    const identifier = toIdentifier(name, pointer);
    if (RESERVED_TYPE_NAMES.has(identifier) || reservedNames.has(identifier)) {
      throw new GenerationError(`Schema name ${JSON.stringify(name)} conflicts with a reserved type name`, pointer);
    }

    const owner = owners.get(identifier);
    if (owner !== undefined) {
      throw new GenerationError(
        `Schemas ${JSON.stringify(owner)} and ${JSON.stringify(name)} both use the type name ${JSON.stringify(identifier)}`,
        pointer,
      );
    }

    owners.set(identifier, name);
    names.set(name, identifier);
  }

  return names;
}

/**
 * Render a declaration for every schema in `components.schemas`.
 *
 * @param context Shared state for the document being converted.
 * @param schemas The `components.schemas` object.
 * @returns The TypeScript source of each declaration, in the order of `context.modelNames`.
 * @throws GenerationError If a schema cannot be converted.
 */
export function buildModelDeclarations(context: GeneratorContext, schemas: Record<string, unknown>): string[] {
  return [...context.modelNames].map(([name, identifier]) => {
    const schema = schemas[name];
    const node = convertSchema(schema, context, pointerTo("#/components/schemas", name));
    return printDeclaration(identifier, node, schemaDocs(schema));
  });
}

/**
 * Convert a schema name into a TypeScript identifier.
 *
 * Valid identifiers are used unchanged. Other names are split on invalid characters
 * and joined in PascalCase, with an underscore prefix if the result starts with a digit.
 *
 * @param name The schema name.
 * @param pointer JSON pointer to the schema.
 * @returns The TypeScript identifier.
 * @throws GenerationError If the name contains no characters usable in an identifier.
 */
function toIdentifier(name: string, pointer: string): string {
  if (IDENTIFIER.test(name)) return name;

  const identifier = name
    .split(NON_IDENTIFIER_CHARACTERS)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");

  if (identifier === "") {
    throw new GenerationError(`Schema name ${JSON.stringify(name)} cannot be converted to a type name`, pointer);
  }

  return /^\d/.test(identifier) ? `_${identifier}` : identifier;
}
