/** Public API for generating TypeScript definitions from OpenAPI documents. */

import { validateDocument } from "./document.ts";
import { convertEndpoints } from "./endpoints.ts";
import { convertModels } from "./models.ts";
import { assignModelNames } from "./naming.ts";
import { printModule } from "./printer.ts";

export { parseDocument, validateDocument } from "./document.ts";
export { GenerationError } from "./errors.ts";
export { GENERATED_NAMES } from "./helpers.ts";
export type { OpenApiDocument } from "./navigation.ts";

/** Options for generating a TypeScript module. */
export interface GenerateOptions {
  /** Name of the source document shown in the header comment, such as a file name. */
  readonly source?: string;
}

/**
 * Generate a TypeScript module describing an OpenAPI document.
 *
 * This runs the same conversion and printing steps as the command line interface,
 * for callers that already have a parsed document.
 *
 * @param document A parsed OpenAPI 3.0 or 3.1 document.
 * @param options Options for the generated module.
 * @returns The TypeScript source of the module.
 * @throws GenerationError If the document cannot be converted.
 */
export function generate(document: unknown, options: GenerateOptions = {}): string {
  const validated = validateDocument(document);
  const modelNames = assignModelNames(validated);
  const models = convertModels(validated, modelNames);
  const endpoints = convertEndpoints(validated, modelNames);
  return printModule(validated, models, endpoints, options.source);
}
