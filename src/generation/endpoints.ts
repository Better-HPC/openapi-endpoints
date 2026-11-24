/**
 * Endpoint map and helper type declarations built from the operations in `paths`.
 *
 * Every path in the document becomes a property of the generated `Endpoints`
 * interface, with one entry per HTTP method. Each entry describes the operation's
 * path parameters, query parameters, JSON request body, and JSON responses. Header
 * and cookie parameters are not included, and content types other than JSON are
 * described as `unknown`.
 *
 * References to reusable parameters, request bodies, and responses are followed as
 * they are read, so a problem inside a shared component is reported at the component
 * rather than at every operation that uses it. As in the models step, the structure
 * of the document is trusted, and error locations are paths from the document root
 * with property names written unescaped.
 *
 * The endpoint map is followed by helper types for looking up parts of it, such as
 * the response body for a path and HTTP method. The helpers rely on mapped and
 * conditional types that the type nodes do not describe, so they are declared as
 * fixed source. The names of the map and the helpers are reserved, and the naming
 * step rejects schemas whose model type would conflict with them.
 */

import {
  buildDocs,
  declaration,
  type DeclarationNode,
  NEVER,
  objectOf,
  property,
  type PropertyNode,
  sourceDeclaration,
  type SourceDeclarationNode,
  type TypeNode,
  union,
  UNKNOWN,
  VOID,
} from "../render.ts";
import type { ComponentSection, OpenApiDocument } from "../openapi/parse.ts";
import { convertSchema } from "./models.ts";
import type { ModelNameMap } from "./naming.ts";

/** Name of the declared endpoint map. */
const ENDPOINTS_NAME = "Endpoints";

/** HTTP methods that can define an operation on a path, in the order used by the OpenAPI specification. */
const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/** Documentation comment lines written above the endpoint map. */
const ENDPOINTS_DOCS = [
  "Request and response types for every operation in the API, keyed by path and HTTP method.",
  "",
  "Each operation describes its path parameters, query parameters, JSON request body,",
  "successful JSON response, and JSON responses keyed by status. Missing parts are `never`.",
];

/** Pattern matching response status keys for successful responses, such as `200` or `2XX`. */
const SUCCESS_STATUS = /^2(?:\d\d|XX)$/i;

/** Pattern matching response status keys for a range of status codes, such as `4XX`. */
const STATUS_RANGE = /^[1-5]XX$/i;

/** Helper types declared after the endpoint map. */
const HELPER_DECLARATIONS: readonly SourceDeclarationNode[] = [
  sourceDeclaration(
    "HttpMethod",
    `export type HttpMethod = ${HTTP_METHODS.map((method) => JSON.stringify(method)).join(" | ")};`,
    ["An HTTP method that can define an operation."],
  ),
  sourceDeclaration(
    "EndpointPath",
    `export type EndpointPath = keyof ${ENDPOINTS_NAME} & string;`,
    ["A path defined in the endpoint map."],
  ),
  sourceDeclaration(
    "EndpointMethod",
    `export type EndpointMethod<P extends EndpointPath> = keyof ${ENDPOINTS_NAME}[P] & HttpMethod;`,
    ["An HTTP method that defines an operation on the given path."],
  ),
  sourceDeclaration(
    "EndpointPathsWith",
    [
      "export type EndpointPathsWith<M extends HttpMethod> = {",
      `  [P in EndpointPath]: M extends keyof ${ENDPOINTS_NAME}[P] ? P : never;`,
      "}[EndpointPath];",
    ].join("\n"),
    ["Paths that define an operation for the given HTTP method."],
  ),
  sourceDeclaration(
    "EndpointOperation",
    [
      "export type EndpointOperation<P extends EndpointPath, M extends HttpMethod> =",
      `  M extends keyof ${ENDPOINTS_NAME}[P] ? ${ENDPOINTS_NAME}[P][M] : never;`,
    ].join("\n"),
    ["The operation for the given path and HTTP method, or `never` if it is not defined."],
  ),
  operationPartHelper("EndpointPathParams", "path", "Path parameters for the given path and HTTP method."),
  operationPartHelper("EndpointQueryParams", "query", "Query parameters for the given path and HTTP method."),
  operationPartHelper("EndpointRequestBody", "body", "JSON request body for the given path and HTTP method."),
  operationPartHelper("EndpointResponse", "response", "Successful response body for the given path and HTTP method."),
  sourceDeclaration(
    "EndpointStatusResponse",
    [
      "export type EndpointStatusResponse<P extends EndpointPath, M extends HttpMethod, S extends number | string> =",
      `  M extends keyof ${ENDPOINTS_NAME}[P]`,
      `    ? (${ENDPOINTS_NAME}[P][M] extends { responses: infer R } ? (S extends keyof R ? R[S] : never) : never)`,
      "    : never;",
    ].join("\n"),
    ["Response body for the given path, HTTP method, and response status."],
  ),
];

/** Names of the types declared by this step, which model types cannot use. */
export const ENDPOINT_TYPE_NAMES: ReadonlySet<string> = new Set([
  ENDPOINTS_NAME,
  ...HELPER_DECLARATIONS.map((helper) => helper.name),
]);

/** Shared state used while converting the operations in a document. */
interface EndpointContext {
  /** The document being converted. */
  readonly document: OpenApiDocument;

  /** TypeScript type names for the schemas in `components.schemas`, keyed by schema name. */
  readonly modelNames: ModelNameMap;
}

/** A section of `components` whose objects are found by following references, rather than declared as named types. */
type ResolvedSection = Exclude<ComponentSection, "schemas">;

/** A document object with any references to other components resolved. */
interface ResolvedObject {
  /** The resolved object. */
  readonly value: Record<string, unknown>;

  /** Location of the resolved object. */
  readonly pointer: string;
}

/** A parameter definition with references resolved. */
interface Parameter {
  /** The parameter name. */
  readonly name: string;

  /** The parameter location, such as `path` or `query`. */
  readonly location: string;

  /** The parameter object from the document. */
  readonly definition: Record<string, unknown>;

  /** Location of the parameter object. */
  readonly pointer: string;
}

/**
 * Convert every operation in the document into the `Endpoints` map, followed by its helper types.
 *
 * @param document The document being converted.
 * @param modelNames TypeScript type names for the schemas in `components.schemas`, keyed by schema name.
 * @returns The `Endpoints` declaration, with one property per path sorted by path, then the helper declarations.
 * @throws Error If a path, operation, or schema cannot be converted.
 */
export function deriveEndpoints(document: OpenApiDocument, modelNames: ModelNameMap): DeclarationNode[] {
  const context: EndpointContext = {document, modelNames};
  const paths = document.paths ?? {};
  const properties = Object.keys(paths).sort().map((path) => {
    return property(path, convertPathItem(paths[path], context, `#/paths/${path}`));
  });

  return [declaration(ENDPOINTS_NAME, objectOf(properties), ENDPOINTS_DOCS), ...HELPER_DECLARATIONS];
}

/**
 * Convert a path item into an object type with one property per HTTP method.
 *
 * @param value The path item object.
 * @param context Shared state for the document being converted.
 * @param pointer Location of the path item.
 * @returns The object type describing the operations on the path.
 * @throws Error If the path item is a reference or an operation cannot be converted.
 */
function convertPathItem(value: unknown, context: EndpointContext, pointer: string): TypeNode {
  const item = value as Record<string, unknown>;
  if (Object.hasOwn(item, "$ref")) {
    throw new Error(`Path item references are not supported at ${pointer}/$ref`);
  }

  const sharedParameters = readParameters(item, context, pointer);
  const methods = HTTP_METHODS.filter((method) => Object.hasOwn(item, method)).map((method) => {
    const location = `${pointer}/${method}`;
    const operation = item[method] as Record<string, unknown>;
    return property(
      method,
      convertOperation(operation, sharedParameters, context, location),
      false,
      operationDocs(operation),
    );
  });

  return objectOf(methods);
}

/**
 * Convert an operation into an object type describing its requests and responses.
 *
 * @param operation The operation object.
 * @param sharedParameters Parameters defined on the path item, which apply to every operation.
 * @param context Shared state for the document being converted.
 * @param pointer Location of the operation.
 * @returns The object type with `path`, `query`, `body`, `response`, and `responses` properties.
 * @throws Error If a parameter, request body, or response cannot be converted.
 */
function convertOperation(
  operation: Record<string, unknown>,
  sharedParameters: readonly Parameter[],
  context: EndpointContext,
  pointer: string,
): TypeNode {
  const parameters = mergeParameters(sharedParameters, readParameters(operation, context, pointer));
  const responses = convertResponses(operation, context, pointer);

  return objectOf([
    property("path", convertParameters(parameters, "path", context)),
    property("query", convertParameters(parameters, "query", context)),
    property("body", convertRequestBody(operation, context, pointer)),
    property("response", successResponse(responses)),
    property("responses", responses.length > 0 ? objectOf(responses) : NEVER),
  ]);
}

/**
 * Return the documentation comment lines describing an operation.
 *
 * @param operation The operation object.
 * @returns The summary and description, followed by `@deprecated` if applicable.
 */
function operationDocs(operation: Record<string, unknown>): string[] {
  const tags = operation["deprecated"] === true ? ["@deprecated"] : [];
  return buildDocs([operation["summary"], operation["description"]], tags);
}

/**
 * Read the parameters listed by a path item or operation, resolving references.
 *
 * @param owner The path item or operation object.
 * @param context Shared state for the document being converted.
 * @param pointer Location of the owner.
 * @returns The parameters in the order they are listed.
 * @throws Error If the parameter list or a parameter is malformed.
 */
function readParameters(owner: Record<string, unknown>, context: EndpointContext, pointer: string): Parameter[] {
  if (!Object.hasOwn(owner, "parameters")) return [];

  const listPointer = `${pointer}/parameters`;
  const list = owner["parameters"];
  if (!Array.isArray(list)) {
    throw new Error(`Expected an array of parameters at ${listPointer}`);
  }

  return list.map((entry, index) => {
    const resolved = resolveObject(entry, "parameters", context, `${listPointer}/${index}`);
    const name = resolved.value["name"];
    const location = resolved.value["in"];
    if (typeof name !== "string" || typeof location !== "string") {
      throw new Error(`Expected a parameter with a string name and location at ${resolved.pointer}`);
    }

    return {name, location, definition: resolved.value, pointer: resolved.pointer};
  });
}

/**
 * Combine path item and operation parameters, letting operation parameters override shared ones.
 *
 * Parameters are matched by name and location, as described by the OpenAPI specification.
 *
 * @param shared Parameters defined on the path item.
 * @param own Parameters defined on the operation.
 * @returns The combined parameters.
 */
function mergeParameters(shared: readonly Parameter[], own: readonly Parameter[]): Parameter[] {
  const merged = new Map<string, Parameter>();
  for (const parameter of [...shared, ...own]) {
    merged.set(`${parameter.location}:${parameter.name}`, parameter);
  }

  return [...merged.values()];
}

/**
 * Convert the parameters in one location into an object type keyed by parameter name.
 *
 * Path parameters are always required. Other parameters are optional unless marked as required.
 *
 * @param parameters The operation's parameters.
 * @param location The parameter location to include.
 * @param context Shared state for the document being converted.
 * @returns The object type, or `never` if the operation has no parameters in the location.
 * @throws Error If a parameter schema cannot be converted.
 */
function convertParameters(
  parameters: readonly Parameter[],
  location: "path" | "query",
  context: EndpointContext,
): TypeNode {
  const properties: PropertyNode[] = parameters
    .filter((parameter) => parameter.location === location)
    .map((parameter) => {
      const tags = parameter.definition["deprecated"] === true ? ["@deprecated"] : [];
      return property(
        parameter.name,
        convertParameterType(parameter, context),
        location !== "path" && parameter.definition["required"] !== true,
        buildDocs([parameter.definition["description"]], tags),
      );
    });

  return properties.length > 0 ? objectOf(properties) : NEVER;
}

/**
 * Convert the schema of a parameter into the type of its value.
 *
 * @param parameter The parameter.
 * @param context Shared state for the document being converted.
 * @returns The parameter type, or `unknown` if the parameter does not define a schema.
 * @throws Error If the parameter schema cannot be converted.
 */
function convertParameterType(parameter: Parameter, context: EndpointContext): TypeNode {
  const {definition, pointer} = parameter;
  if (Object.hasOwn(definition, "schema")) {
    return convertSchema(definition["schema"], context.modelNames, `${pointer}/schema`);
  }

  // Parameters may describe their value with a single media type instead of a schema
  const contentPointer = `${pointer}/content`;
  const content = (definition["content"] ?? {}) as Record<string, unknown>;
  const [entry] = Object.entries(content);
  if (entry === undefined) return UNKNOWN;

  const [mediaType, media] = entry;
  const mediaPointer = `${contentPointer}/${mediaType}`;
  const mediaObject = media as Record<string, unknown>;
  return Object.hasOwn(mediaObject, "schema")
    ? convertSchema(mediaObject["schema"], context.modelNames, `${mediaPointer}/schema`)
    : UNKNOWN;
}

/**
 * Convert the JSON content of an operation's request body.
 *
 * @param operation The operation object.
 * @param context Shared state for the document being converted.
 * @param pointer Location of the operation.
 * @returns The request body type, or `never` if the operation does not accept a JSON body.
 * @throws Error If the request body cannot be converted.
 */
function convertRequestBody(operation: Record<string, unknown>, context: EndpointContext, pointer: string): TypeNode {
  if (!Object.hasOwn(operation, "requestBody")) return NEVER;

  const body = resolveObject(operation["requestBody"], "requestBodies", context, `${pointer}/requestBody`);
  return convertJsonContent(body.value, context, body.pointer) ?? NEVER;
}

/**
 * Convert the responses of an operation into properties keyed by status code.
 *
 * Responses are sorted by status code, followed by status ranges and the default response.
 *
 * @param operation The operation object.
 * @param context Shared state for the document being converted.
 * @param pointer Location of the operation.
 * @returns One property per response.
 * @throws Error If a response cannot be converted.
 */
function convertResponses(operation: Record<string, unknown>, context: EndpointContext, pointer: string): PropertyNode[] {
  const responsesPointer = `${pointer}/responses`;
  const responses = (operation["responses"] ?? {}) as Record<string, unknown>;

  return Object.keys(responses).sort(compareStatuses).map((status) => {
    const response = resolveObject(responses[status], "responses", context, `${responsesPointer}/${status}`);
    return property(
      status,
      convertResponseBody(response.value, context, response.pointer),
      false,
      buildDocs([response.value["description"]]),
    );
  });
}

/**
 * Convert the content of a response into the type of its body.
 *
 * @param response The response object.
 * @param context Shared state for the document being converted.
 * @param pointer Location of the response.
 * @returns The JSON body type, `void` if the response has no body, or `unknown` for other content types.
 * @throws Error If the response content cannot be converted.
 */
function convertResponseBody(response: Record<string, unknown>, context: EndpointContext, pointer: string): TypeNode {
  const content = (response["content"] ?? {}) as Record<string, unknown>;
  if (Object.keys(content).length === 0) return VOID;
  return convertJsonContent(response, context, pointer) ?? UNKNOWN;
}

/**
 * Convert the JSON media types of a request body or response into a type.
 *
 * @param owner The request body or response object.
 * @param context Shared state for the document being converted.
 * @param pointer Location of the owner.
 * @returns The union of the JSON schemas, or `undefined` if there is no JSON content.
 * @throws Error If a schema cannot be converted.
 */
function convertJsonContent(owner: Record<string, unknown>, context: EndpointContext, pointer: string): TypeNode | undefined {
  const contentPointer = `${pointer}/content`;
  const content = (owner["content"] ?? {}) as Record<string, unknown>;

  const types = Object.entries(content)
    .filter(([mediaType]) => isJsonMediaType(mediaType))
    .map(([mediaType, media]) => {
      const mediaPointer = `${contentPointer}/${mediaType}`;
      const mediaObject = media as Record<string, unknown>;
      return Object.hasOwn(mediaObject, "schema")
        ? convertSchema(mediaObject["schema"], context.modelNames, `${mediaPointer}/schema`)
        : UNKNOWN;
    });

  return types.length > 0 ? union(types) : undefined;
}

/**
 * Return a parameter, request body, or response object, following `$ref` values until a concrete object is found.
 *
 * @param value The object, which may be a reference object.
 * @param section The components section references must point into.
 * @param context Shared state for the document being converted.
 * @param pointer Location of the object.
 * @returns The resolved object and its location.
 * @throws Error If a reference does not match a component in the section, or is circular.
 */
function resolveObject(
  value: unknown,
  section: ResolvedSection,
  context: EndpointContext,
  pointer: string,
): ResolvedObject {
  const entries = context.document.components?.[section] ?? {};
  const prefix = `#/components/${section}/`;
  const visited = new Set<string>();

  let current = value as Record<string, unknown>;
  let location = pointer;
  while (Object.hasOwn(current, "$ref")) {
    const ref = current["$ref"];
    const refPointer = `${location}/$ref`;
    const name = typeof ref === "string" && ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
    if (name === undefined || !Object.hasOwn(entries, name)) {
      throw new Error(`Reference ${JSON.stringify(ref)} does not match any component in \`components.${section}\` at ${refPointer}`);
    }

    if (visited.has(name)) {
      throw new Error(`Circular reference to ${JSON.stringify(ref)} at ${refPointer}`);
    }

    visited.add(name);
    location = `#/components/${section}/${name}`;
    current = entries[name] as Record<string, unknown>;
  }

  return {value: current, pointer: location};
}

/**
 * Return the type of a successful response to an operation.
 *
 * @param responses The operation's responses, keyed by status.
 * @returns The union of all `2xx` responses, the default response if there are none, or `unknown`.
 */
function successResponse(responses: readonly PropertyNode[]): TypeNode {
  const successes = responses.filter((response) => SUCCESS_STATUS.test(response.name));
  if (successes.length > 0) {
    return union(successes.map((response) => response.type));
  }

  return responses.find((response) => response.name === "default")?.type ?? UNKNOWN;
}

/**
 * Return whether a media type describes JSON content.
 *
 * @param mediaType The media type, which may include parameters such as a character set.
 * @returns Whether the media type is `application/json` or uses the `+json` structured syntax suffix.
 */
function isJsonMediaType(mediaType: string): boolean {
  const base = (mediaType.split(";")[0] ?? "").trim().toLowerCase();
  return base === "application/json" || base.endsWith("+json");
}

/**
 * Compare two response status keys for sorting.
 *
 * @param left The first status key.
 * @param right The second status key.
 * @returns A negative number, zero, or a positive number, as expected by `Array.prototype.sort`.
 */
function compareStatuses(left: string, right: string): number {
  return statusRank(left) - statusRank(right) || (left < right ? -1 : left > right ? 1 : 0);
}

/**
 * Return a sort rank for a response status key.
 *
 * @param status The status key, such as `200`, `4XX`, or `default`.
 * @returns The numeric status for codes, the end of the range for ranges, and a large value otherwise.
 */
function statusRank(status: string): number {
  if (/^\d{3}$/.test(status)) return Number(status);
  if (STATUS_RANGE.test(status)) return Number(status.charAt(0)) * 100 + 99.5;
  return status === "default" ? 1000 : 1001;
}

/**
 * Build a helper type that extracts one part of an operation from the endpoint map.
 *
 * @param name The name of the helper type.
 * @param key The operation property the helper extracts.
 * @param description A one sentence description of the extracted part.
 * @returns The helper declaration.
 */
function operationPartHelper(name: string, key: string, description: string): SourceDeclarationNode {
  const source = [
    `export type ${name}<P extends EndpointPath, M extends HttpMethod> =`,
    `  M extends keyof ${ENDPOINTS_NAME}[P] ? (${ENDPOINTS_NAME}[P][M] extends { ${key}: infer T } ? T : never) : never;`,
  ].join("\n");

  return sourceDeclaration(name, source, [description.replace(/\.$/, ", or `never` if the operation does not define it.")]);
}
