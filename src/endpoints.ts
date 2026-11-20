/**
 * Endpoint map built from the operations in `paths`.
 *
 * Every path in the document becomes a property of the generated `Endpoints`
 * interface, with one entry per HTTP method. Each entry describes the operation's
 * path parameters, query parameters, JSON request body, and JSON responses. Header
 * and cookie parameters are not included, and content types other than JSON are
 * described as `unknown`.
 */

import { expectRecord, hasOwn, optionalRecord, pointerTo, resolveObject } from "./document.ts";
import { GenerationError } from "./errors.ts";
import { NEVER, objectOf, property, type PropertyNode, type TypeNode, union, UNKNOWN, VOID } from "./nodes.ts";
import { buildDocs } from "./printer.ts";
import { convertSchema, type GeneratorContext } from "./schemas.ts";

/** HTTP methods that can define an operation on a path, in the order used by the OpenAPI specification. */
export const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/** An HTTP method that can define an operation on a path. */
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Pattern matching response status keys for successful responses, such as `200` or `2XX`. */
const SUCCESS_STATUS = /^2(?:\d\d|XX)$/i;

/** Pattern matching response status keys for a range of status codes, such as `4XX`. */
const STATUS_RANGE = /^[1-5]XX$/i;

/** A parameter definition with references resolved. */
interface Parameter {
  /** The parameter name. */
  readonly name: string;

  /** The parameter location, such as `path` or `query`. */
  readonly location: string;

  /** The parameter object from the document. */
  readonly definition: Record<string, unknown>;

  /** JSON pointer to the parameter object. */
  readonly pointer: string;
}

/**
 * Build the type of the `Endpoints` map for every operation in the document.
 *
 * @param context Shared state for the document being converted.
 * @returns An object type with one property per path, sorted by path.
 * @throws GenerationError If a path, operation, or schema cannot be converted.
 */
export function buildEndpoints(context: GeneratorContext): TypeNode {
  const paths = optionalRecord(context.document, "paths", "#");
  const properties = Object.keys(paths).sort().map((path) => {
    return property(path, convertPathItem(paths[path], context, pointerTo("#/paths", path)));
  });

  return objectOf(properties);
}

/**
 * Convert a path item into an object type with one property per HTTP method.
 *
 * @param value The path item object.
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the path item.
 * @returns The object type describing the operations on the path.
 * @throws GenerationError If the path item is a reference or contains invalid operations.
 */
function convertPathItem(value: unknown, context: GeneratorContext, pointer: string): TypeNode {
  const item = expectRecord(value, pointer);
  if (hasOwn(item, "$ref")) {
    throw new GenerationError("Path item references are not supported", pointerTo(pointer, "$ref"));
  }

  const sharedParameters = readParameters(item, context, pointer);
  const methods = HTTP_METHODS.filter((method) => hasOwn(item, method)).map((method) => {
    const location = pointerTo(pointer, method);
    const operation = expectRecord(item[method], location);
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
 * @param pointer JSON pointer to the operation.
 * @returns The object type with `path`, `query`, `body`, `response`, and `responses` properties.
 * @throws GenerationError If a parameter, request body, or response cannot be converted.
 */
function convertOperation(
  operation: Record<string, unknown>,
  sharedParameters: readonly Parameter[],
  context: GeneratorContext,
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
 * @param pointer JSON pointer to the owner.
 * @returns The parameters in the order they are listed.
 * @throws GenerationError If the parameter list or a parameter is malformed.
 */
function readParameters(owner: Record<string, unknown>, context: GeneratorContext, pointer: string): Parameter[] {
  if (!hasOwn(owner, "parameters")) return [];

  const listPointer = pointerTo(pointer, "parameters");
  const list = owner["parameters"];
  if (!Array.isArray(list)) {
    throw new GenerationError("Expected an array of parameters", listPointer);
  }

  return list.map((entry, index) => {
    const resolved = resolveObject(context.document, entry, "parameters", pointerTo(listPointer, index));
    const name = resolved.value["name"];
    const location = resolved.value["in"];
    if (typeof name !== "string" || typeof location !== "string") {
      throw new GenerationError("Expected a parameter with a string name and location", resolved.pointer);
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
 * @throws GenerationError If a parameter schema cannot be converted.
 */
function convertParameters(
  parameters: readonly Parameter[],
  location: "path" | "query",
  context: GeneratorContext,
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
 * @throws GenerationError If the parameter schema cannot be converted.
 */
function convertParameterType(parameter: Parameter, context: GeneratorContext): TypeNode {
  const {definition, pointer} = parameter;
  if (hasOwn(definition, "schema")) {
    return convertSchema(definition["schema"], context, pointerTo(pointer, "schema"));
  }

  // Parameters may describe their value with a single media type instead of a schema
  const contentPointer = pointerTo(pointer, "content");
  const content = optionalRecord(definition, "content", pointer);
  const [entry] = Object.entries(content);
  if (entry === undefined) return UNKNOWN;

  const [mediaType, media] = entry;
  const mediaPointer = pointerTo(contentPointer, mediaType);
  const mediaObject = expectRecord(media, mediaPointer);
  return hasOwn(mediaObject, "schema")
    ? convertSchema(mediaObject["schema"], context, pointerTo(mediaPointer, "schema"))
    : UNKNOWN;
}

/**
 * Convert the JSON content of an operation's request body.
 *
 * @param operation The operation object.
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the operation.
 * @returns The request body type, or `never` if the operation does not accept a JSON body.
 * @throws GenerationError If the request body cannot be converted.
 */
function convertRequestBody(operation: Record<string, unknown>, context: GeneratorContext, pointer: string): TypeNode {
  if (!hasOwn(operation, "requestBody")) return NEVER;

  const body = resolveObject(context.document, operation["requestBody"], "requestBodies", pointerTo(pointer, "requestBody"));
  return convertJsonContent(body.value, context, body.pointer) ?? NEVER;
}

/**
 * Convert the responses of an operation into properties keyed by status code.
 *
 * Responses are sorted by status code, followed by status ranges and the default response.
 *
 * @param operation The operation object.
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the operation.
 * @returns One property per response.
 * @throws GenerationError If a response cannot be converted.
 */
function convertResponses(operation: Record<string, unknown>, context: GeneratorContext, pointer: string): PropertyNode[] {
  const responsesPointer = pointerTo(pointer, "responses");
  const responses = optionalRecord(operation, "responses", pointer);

  return Object.keys(responses).sort(compareStatuses).map((status) => {
    const response = resolveObject(context.document, responses[status], "responses", pointerTo(responsesPointer, status));
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
 * @param pointer JSON pointer to the response.
 * @returns The JSON body type, `void` if the response has no body, or `unknown` for other content types.
 * @throws GenerationError If the response content cannot be converted.
 */
function convertResponseBody(response: Record<string, unknown>, context: GeneratorContext, pointer: string): TypeNode {
  const content = optionalRecord(response, "content", pointer);
  if (Object.keys(content).length === 0) return VOID;
  return convertJsonContent(response, context, pointer) ?? UNKNOWN;
}

/**
 * Convert the JSON media types of a request body or response into a type.
 *
 * @param owner The request body or response object.
 * @param context Shared state for the document being converted.
 * @param pointer JSON pointer to the owner.
 * @returns The union of the JSON schemas, or `undefined` if there is no JSON content.
 * @throws GenerationError If a media type object or schema is malformed.
 */
function convertJsonContent(owner: Record<string, unknown>, context: GeneratorContext, pointer: string): TypeNode | undefined {
  const contentPointer = pointerTo(pointer, "content");
  const content = optionalRecord(owner, "content", pointer);

  const types = Object.entries(content)
    .filter(([mediaType]) => isJsonMediaType(mediaType))
    .map(([mediaType, media]) => {
      const mediaPointer = pointerTo(contentPointer, mediaType);
      const mediaObject = expectRecord(media, mediaPointer);
      return hasOwn(mediaObject, "schema")
        ? convertSchema(mediaObject["schema"], context, pointerTo(mediaPointer, "schema"))
        : UNKNOWN;
    });

  return types.length > 0 ? union(types) : undefined;
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
