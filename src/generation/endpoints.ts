/** Endpoint map and helper type declarations for the operations in `paths`. */

import type { ComponentSection, OpenApiDocument } from "../openapi/parse.ts";
import { convertSchema } from "./models.ts";
import type { ModelNameMap } from "./naming.ts";
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
} from "./utils.ts";

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

/** Regex matching for the status keys of successful responses, such as `200` or `2XX`. */
const SUCCESS_STATUS = /^2(?:\d\d|XX)$/i;

/** Regex matching for status keys covering a range of status codes, such as `4XX`. */
const STATUS_RANGE = /^[1-5]XX$/i;

/**
 * Helper types declared after the endpoint map.
 *
 * The helpers rely on generic parameters and conditional types, which type nodes
 * cannot describe, so they are declared as fixed TypeScript source.
 */
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

/** Names of the types declared by this module, which `deriveModelNames` rejects as model type names. */
export const ENDPOINT_TYPE_NAMES: ReadonlySet<string> = new Set([
  ENDPOINTS_NAME,
  ...HELPER_DECLARATIONS.map((helper) => helper.name),
]);

/** Shared state used while converting the operations in a document. */
interface EndpointContext {
  /** The parsed OpenAPI specification. */
  readonly openApiSpec: OpenApiDocument;

  /** TypeScript type names for the schemas in `components.schemas`, keyed by schema name. */
  readonly modelNames: ModelNameMap;
}

/** A property of the OpenAPI `components` field whose objects are found by following references. */
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
 * Convert the operations in an OpenAPI specification into endpoint declarations.
 *
 * The `Endpoints` map has one property per path, sorted by path, and is followed by
 * the helper types in `HELPER_DECLARATIONS`.
 *
 * @param openApiSpec The parsed OpenAPI specification.
 * @param modelNames TypeScript type names for the schemas in `components.schemas`, keyed by schema name.
 * @returns The `Endpoints` declaration followed by the helper declarations.
 * @throws Error If a path, operation, or schema cannot be converted.
 */
export function deriveEndpoints(openApiSpec: OpenApiDocument, modelNames: ModelNameMap): DeclarationNode[] {
  const context: EndpointContext = {openApiSpec, modelNames};
  const paths = openApiSpec.paths ?? {};
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
  const pathItem = value as Record<string, unknown>;
  if (Object.hasOwn(pathItem, "$ref")) {
    throw new Error(`Path item references are not supported at ${pointer}/$ref`);
  }

  const sharedParameters = readParameters(pathItem, context, pointer);
  const methods = HTTP_METHODS.filter((method) => Object.hasOwn(pathItem, method)).map((method) => {
    const operationPointer = `${pointer}/${method}`;
    const operation = pathItem[method] as Record<string, unknown>;
    return property(
      method,
      convertOperation(operation, sharedParameters, context, operationPointer),
      false,
      operationDocs(operation),
    );
  });

  return objectOf(methods);
}

/**
 * Convert an operation into an object type describing its requests and responses.
 *
 * Only path and query parameters are included. Header and cookie parameters are skipped.
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
  if (!Object.hasOwn(owner, "parameters")) {
    return [];
  }

  const listPointer = `${pointer}/parameters`;
  const parameterList = owner["parameters"];
  if (!Array.isArray(parameterList)) {
    throw new Error(`Expected an array of parameters at ${listPointer}`);
  }

  // Resolve each parameter and confirm it has a name and location
  return parameterList.map((entry, index) => {
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
 * Combine the parameters of a path item and one of its operations.
 *
 * Parameters are matched by name and location, as described by the OpenAPI
 * specification, and an operation parameter replaces a matching path item parameter.
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
  const [mediaEntry] = Object.entries(content);
  if (mediaEntry === undefined) {
    return UNKNOWN;
  }

  const [mediaType, media] = mediaEntry;
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
  if (!Object.hasOwn(operation, "requestBody")) {
    return NEVER;
  }

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
 * Responses without content have no body and are typed as `void`. Responses whose
 * content has no JSON media types are typed as `unknown`.
 *
 * @param response The response object.
 * @param context Shared state for the document being converted.
 * @param pointer Location of the response.
 * @returns The response body type.
 * @throws Error If the response content cannot be converted.
 */
function convertResponseBody(response: Record<string, unknown>, context: EndpointContext, pointer: string): TypeNode {
  const content = (response["content"] ?? {}) as Record<string, unknown>;
  if (Object.keys(content).length === 0) {
    return VOID;
  }

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
 * Return a parameter, request body, or response object with references resolved.
 *
 * References are followed until an object without a `$ref` is found. Because the
 * resolved location is returned, a problem inside a shared component is reported at
 * the component rather than at every operation that uses it.
 *
 * @param value The object, which may be a reference object.
 * @param section The property of `components` that references must point into.
 * @param context Shared state for the document being converted.
 * @param pointer Location of the object.
 * @returns The resolved object and its location.
 * @throws Error If a reference does not match a component in `section`, or is circular.
 */
function resolveObject(
  value: unknown,
  section: ResolvedSection,
  context: EndpointContext,
  pointer: string,
): ResolvedObject {
  const components = context.openApiSpec.components?.[section] ?? {};
  const prefix = `#/components/${section}/`;
  const visited = new Set<string>();

  let currentObject = value as Record<string, unknown>;
  let currentPointer = pointer;
  while (Object.hasOwn(currentObject, "$ref")) {
    // Confirm the reference points to an existing component
    const ref = currentObject["$ref"];
    const refPointer = `${currentPointer}/$ref`;
    const name = typeof ref === "string" && ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
    if (name === undefined || !Object.hasOwn(components, name)) {
      throw new Error(`Reference ${JSON.stringify(ref)} does not match any component in \`components.${section}\` at ${refPointer}`);
    }

    // Guard against references that loop back on themselves
    if (visited.has(name)) {
      throw new Error(`Circular reference to ${JSON.stringify(ref)} at ${refPointer}`);
    }

    visited.add(name);
    currentPointer = `#/components/${section}/${name}`;
    currentObject = components[name] as Record<string, unknown>;
  }

  return {value: currentObject, pointer: currentPointer};
}

/**
 * Return the type of a successful response to an operation.
 *
 * The type is the union of all `2xx` responses. If there are none, the default
 * response is used, and if that is missing too, the type is `unknown`.
 *
 * @param responses The operation's responses, keyed by status.
 * @returns The successful response type.
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
  const baseType = (mediaType.split(";")[0] ?? "").trim().toLowerCase();
  return baseType === "application/json" || baseType.endsWith("+json");
}

/**
 * Compare two response status keys for sorting.
 *
 * @param left The first status key.
 * @param right The second status key.
 * @returns A negative number, zero, or a positive number, as expected by `Array.prototype.sort`.
 */
function compareStatuses(left: string, right: string): number {
  const rankDifference = statusRank(left) - statusRank(right);
  if (rankDifference !== 0) {
    return rankDifference;
  }

  // Keys with the same rank, such as `4XX` and `4xx`, are ordered by their text
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

/**
 * Return a sort rank for a response status key.
 *
 * Status codes rank by their number, and ranges such as `4XX` rank just after the
 * last code in the range. The `default` response ranks after every status, and any
 * other key ranks last.
 *
 * @param status The status key, such as `200`, `4XX`, or `default`.
 * @returns The sort rank of the status key.
 */
function statusRank(status: string): number {
  if (/^\d{3}$/.test(status)) {
    return Number(status);
  }

  if (STATUS_RANGE.test(status)) {
    return Number(status.charAt(0)) * 100 + 99.5;
  }

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
