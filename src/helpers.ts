/**
 * Helper types declared in every generated module.
 *
 * The helpers are generic lookups into the `Endpoints` map, such as the response body
 * for a path and HTTP method. They rely on mapped and conditional types that the type
 * nodes do not describe, so they are kept as fixed TypeScript source and printed
 * unchanged after the endpoint map. Their names are reserved so that no schema can
 * produce a model type that conflicts with them.
 */

import { HTTP_METHODS } from "./navigation.ts";

/** A helper type declared in every generated module. */
export interface HelperDeclaration {
  /** The name of the declared type. */
  readonly name: string;

  /** Lines of the documentation comment written above the declaration. */
  readonly docs: readonly string[];

  /** The TypeScript source of the declaration. */
  readonly source: string;
}

/** Helper types declared after the endpoint map in every generated module. */
export const HELPER_DECLARATIONS: readonly HelperDeclaration[] = [
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
