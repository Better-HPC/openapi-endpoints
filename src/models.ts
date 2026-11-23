/**
 * Model type declarations for the schemas in `components.schemas`.
 *
 * Each schema becomes a declaration named after the schema, so other generated types
 * can refer to models by name and applications can import them directly. The names
 * are chosen beforehand by the naming step, and each schema is converted by the
 * shared schema converter that also handles schemas inside operations.
 */

import type { ModelNames } from "./naming.ts";
import { pointerTo, readComponents, type OpenApiDocument } from "./navigation.ts";
import { declaration, type DeclarationNode } from "./nodes.ts";
import { convertSchema, schemaDocs, type GeneratorContext } from "./schemas.ts";

/**
 * Convert every schema in `components.schemas` into a model type declaration.
 *
 * @param document The document being converted.
 * @param modelNames TypeScript type names for the schemas, keyed by schema name.
 * @returns One declaration per schema, in the order of `modelNames`.
 * @throws GenerationError If a schema cannot be converted.
 */
export function convertModels(document: OpenApiDocument, modelNames: ModelNames): DeclarationNode[] {
  const schemas = readComponents(document, "schemas");
  const context: GeneratorContext = {document, modelNames};

  return [...modelNames].map(([name, identifier]) => {
    const schema = schemas[name];
    const type = convertSchema(schema, context, pointerTo("#/components/schemas", name));
    return declaration(identifier, type, schemaDocs(schema));
  });
}
