/**
 * Generation of a complete TypeScript module from an OpenAPI document.
 *
 * The generated module contains a type for every schema in `components.schemas`, an
 * `Endpoints` interface mapping each path and HTTP method to its request and response
 * types, and helper types for looking up parts of that map. The module contains only
 * type declarations, so it adds no code to a compiled application.
 */

import { isRecord, optionalRecord, validateDocument, type OpenApiDocument } from "./document.ts";
import { buildEndpoints, HTTP_METHODS } from "./endpoints.ts";
import { buildModelDeclarations, createModelNames } from "./models.ts";
import { printDeclaration, printDocComment } from "./printer.ts";
import type { GeneratorContext } from "./schemas.ts";

/** Options for generating a TypeScript module. */
export interface GenerateOptions {
  /** Name of the source document shown in the header comment, such as a file name or URL. */
  readonly source?: string;
}

/** A helper type declared in every generated module. */
interface HelperDeclaration {
  /** The name of the declared type. */
  readonly name: string;

  /** Lines of the documentation comment written above the declaration. */
  readonly docs: readonly string[];

  /** The TypeScript source of the declaration. */
  readonly source: string;
}

/** Name of the generator, shown in the header comment of generated modules. */
const GENERATOR_NAME = "openapi-endpoints";

/** Section label written above the model types. */
const MODELS_LABEL = "// Model types for the schemas in `components.schemas`";

/** Section label written above the endpoint map. */
const ENDPOINTS_LABEL = "// Request and response types for each operation in `paths`";

/** Section label written above the helper types. */
const HELPERS_LABEL = "// Helper types for looking up parts of the endpoint map";

/** Documentation comment lines written above the `Endpoints` interface. */
const ENDPOINTS_DOCS = [
  "Request and response types for every operation in the API, keyed by path and HTTP method.",
  "",
  "Each operation describes its path parameters, query parameters, JSON request body,",
  "successful JSON response, and JSON responses keyed by status. Missing parts are `never`.",
];

/** Helper types declared after the endpoint map in every generated module. */
const HELPER_DECLARATIONS: readonly HelperDeclaration[] = [
  {
    name: "HttpMethod",
    docs: ["An HTTP method that can define an operation."],
    source: `export type HttpMethod = ${HTTP_METHODS.map((method) => JSON.stringify(method)).join(" | ")};`,
  },
  {
    name: "EndpointPath",
    docs: ["A path defined in the endpoint map."],
    source: "export type EndpointPath = keyof Endpoints & string;",
  },
  {
    name: "EndpointMethod",
    docs: ["An HTTP method that defines an operation on the given path."],
    source: "export type EndpointMethod<P extends EndpointPath> = keyof Endpoints[P] & HttpMethod;",
  },
  {
    name: "EndpointPathsWith",
    docs: ["Paths that define an operation for the given HTTP method."],
    source: [
      "export type EndpointPathsWith<M extends HttpMethod> = {",
      "  [P in EndpointPath]: M extends keyof Endpoints[P] ? P : never;",
      "}[EndpointPath];",
    ].join("\n"),
  },
  {
    name: "EndpointOperation",
    docs: ["The operation for the given path and HTTP method, or `never` if it is not defined."],
    source: [
      "export type EndpointOperation<P extends EndpointPath, M extends HttpMethod> =",
      "  M extends keyof Endpoints[P] ? Endpoints[P][M] : never;",
    ].join("\n"),
  },
  operationPartHelper("EndpointPathParams", "path", "Path parameters for the given path and HTTP method."),
  operationPartHelper("EndpointQueryParams", "query", "Query parameters for the given path and HTTP method."),
  operationPartHelper("EndpointRequestBody", "body", "JSON request body for the given path and HTTP method."),
  operationPartHelper("EndpointResponse", "response", "Successful response body for the given path and HTTP method."),
  {
    name: "EndpointStatusResponse",
    docs: ["Response body for the given path, HTTP method, and response status."],
    source: [
      "export type EndpointStatusResponse<P extends EndpointPath, M extends HttpMethod, S extends number | string> =",
      "  M extends keyof Endpoints[P]",
      "    ? (Endpoints[P][M] extends { responses: infer R } ? (S extends keyof R ? R[S] : never) : never)",
      "    : never;",
    ].join("\n"),
  },
];

/** Names declared by every generated module in addition to the model types. */
export const GENERATED_NAMES: ReadonlySet<string> = new Set([
  "Endpoints",
  ...HELPER_DECLARATIONS.map((helper) => helper.name),
]);

/**
 * Generate a TypeScript module describing an OpenAPI document.
 *
 * @param document A parsed OpenAPI 3.0 or 3.1 document.
 * @param options Options for the generated module.
 * @returns The TypeScript source of the module.
 * @throws GenerationError If the document cannot be converted.
 */
export function generate(document: unknown, options: GenerateOptions = {}): string {
  const validated = validateDocument(document);
  const schemas = optionalRecord(optionalRecord(validated, "components", "#"), "schemas", "#/components");
  const context: GeneratorContext = {
    document: validated,
    modelNames: createModelNames(schemas, GENERATED_NAMES),
  };

  const models = buildModelDeclarations(context, schemas);
  const endpoints = printDeclaration("Endpoints", buildEndpoints(context), ENDPOINTS_DOCS);
  const helpers = HELPER_DECLARATIONS.map((helper) => `${printDocComment(helper.docs)}\n${helper.source}`);

  const blocks = [
    printHeader(validated, options.source),
    ...(models.length > 0 ? [MODELS_LABEL, ...models] : []),
    ENDPOINTS_LABEL,
    endpoints,
    HELPERS_LABEL,
    ...helpers,
  ];

  return `${blocks.join("\n\n")}\n`;
}

/**
 * Build a helper type that extracts one part of an operation from the endpoint map.
 *
 * @param name The name of the helper type.
 * @param key The operation property the helper extracts.
 * @param description A one sentence description of the extracted part.
 * @returns The helper declaration.
 */
function operationPartHelper(name: string, key: string, description: string): HelperDeclaration {
  return {
    name,
    docs: [description.replace(/\.$/, ", or `never` if the operation does not define it.")],
    source: [
      `export type ${name}<P extends EndpointPath, M extends HttpMethod> =`,
      `  M extends keyof Endpoints[P] ? (Endpoints[P][M] extends { ${key}: infer T } ? T : never) : never;`,
    ].join("\n"),
  };
}

/**
 * Render the header comment of a generated module.
 *
 * @param document The source document.
 * @param source Name of the source document, if known.
 * @returns The TypeScript source of the header comment.
 */
function printHeader(document: OpenApiDocument, source: string | undefined): string {
  const info = isRecord(document["info"]) ? document["info"] : {};
  const title = typeof info["title"] === "string" && info["title"].trim() !== ""
    ? info["title"].trim()
    : "an OpenAPI document";

  const version = info["version"];
  const versionText = typeof version === "string" || typeof version === "number" ? ` (version ${version})` : "";
  const sourceText = source ? ` from \`${source}\`` : "";

  return printDocComment([
    `TypeScript definitions for ${title}${versionText}.`,
    "",
    `This module was generated by ${GENERATOR_NAME}${sourceText}. Do not edit`,
    "it directly, because changes are lost the next time it is generated.",
  ]);
}
