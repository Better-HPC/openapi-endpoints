/** Public API for generating TypeScript definitions from OpenAPI documents. */

export { parseDocument, validateDocument, type OpenApiDocument } from "./document.ts";
export { GenerationError } from "./errors.ts";
export { generate, GENERATED_NAMES, type GenerateOptions } from "./generate.ts";
