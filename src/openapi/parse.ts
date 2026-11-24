/** Parsing and validation for OpenAPI documents. */

import { parse } from "yaml";

/** Regex matching the supported OpenAPI versions. */
const SUPPORTED_VERSION = /^3\.[01](?:\.\d+)?$/;

/** Sections of `components` read by the conversion steps, in alphabetical order. */
const COMPONENT_SECTIONS = ["parameters", "requestBodies", "responses", "schemas"] as const;

/** A section of `components` read by the conversion steps. */
export type ComponentSection = (typeof COMPONENT_SECTIONS)[number];

/** Metadata about the API described by an OpenAPI document. */
export interface OpenApiInfo {
  /** The title of the API. */
  readonly title: string;

  /** The version of the API, which YAML documents may write as a number. */
  readonly version: string | number;

  /** Any other undeclared properties. */
  readonly [key: string]: unknown;
}

/** Reusable objects that other parts of an OpenAPI document can reference. */
export interface OpenApiComponents {
  /** Reusable parameter objects, keyed by name. */
  readonly parameters?: Record<string, unknown>;

  /** Reusable request body objects, keyed by name. */
  readonly requestBodies?: Record<string, unknown>;

  /** Reusable response objects, keyed by name. */
  readonly responses?: Record<string, unknown>;

  /** Reusable schema objects, keyed by name. */
  readonly schemas?: Record<string, unknown>;

  /** Any other undeclared properties. */
  readonly [key: string]: unknown;
}

/** A parsed OpenAPI 3.0 or 3.1 document. */
export interface OpenApiDocument {
  /** The version of the OpenAPI specification used by the document. */
  readonly openapi: string;

  /** Metadata about the API, such as its title and version. */
  readonly info: OpenApiInfo;

  /** The default JSON Schema dialect for schemas in the document (OpenAPI 3.1 only). */
  readonly jsonSchemaDialect?: unknown;

  /** Operations available on each path, keyed by path template. */
  readonly paths?: Record<string, unknown>;

  /** Requests the API may send to the client, keyed by name (OpenAPI 3.1 only). */
  readonly webhooks?: unknown;

  /** Reusable objects that other parts of the document can reference. */
  readonly components?: OpenApiComponents;

  /** Security requirements that apply to every operation by default. */
  readonly security?: unknown;

  /** Tags used to group operations, with additional metadata. */
  readonly tags?: unknown;

  /** A link to external documentation for the API. */
  readonly externalDocs?: unknown;

  /** Any other undeclared properties. */
  readonly [key: string]: unknown;
}

/**
 * Parse the YAML or JSON text from an OpenAPI specification.
 *
 * @param text The text of an OpenAPI specification.
 * @returns The parsed and validated content.
 * @throws Error If the input cannot be parsed or is not a supported OpenAPI document.
 */
export function parseOpenApiText(text: string): OpenApiDocument {
  let value: unknown;
  try {
    value = parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The document is not valid YAML or JSON: ${reason} at #`);
  }

  return validateDocument(value);
}

/**
 * Confirm a file parsing result is a valid OpenAPI document with a supported version.
 *
 * The following properties are checked:
 *
 * - The value is an object.
 * - The `openapi` property is a string matching a supported version.
 * - The `info` property is an object with a string `title` and a string or numeric `version`.
 * - The `paths` and `components` properties are objects, if present.
 * - The `components` sections read by the generator are objects, if present.
 *
 * @param value The value parsed from the document text.
 * @returns The input value, typed as an OpenAPI document.
 * @throws Error If the value is not a valid OpenAPI specification.
 */
function validateDocument(value: unknown): OpenApiDocument {
  const document = expectRecord(value, "#");

  // Confirm the specification version is supported
  const version = document["openapi"];
  if (typeof version !== "string" || !SUPPORTED_VERSION.test(version)) {
    throw new Error("The provided OpenAPI version is not supported at #/openapi");
  }

  // Confirm the API metadata shown in the generated header
  const info = expectRecord(document["info"], "#/info");
  if (typeof info["title"] !== "string") {
    throw new Error("Expected a string at #/info/title");
  }

  // The specification requires a string, but unquoted YAML versions such as `1.0` parse as numbers
  const apiVersion = info["version"];
  if (typeof apiVersion !== "string" && typeof apiVersion !== "number") {
    throw new Error("Expected a string at #/info/version");
  }

  // Confirm the sections iterated over by the conversion steps are objects
  optionalRecord(document, "paths", "#");
  const components = optionalRecord(document, "components", "#");
  for (const section of COMPONENT_SECTIONS) {
    optionalRecord(components, section, "#/components");
  }

  return document as OpenApiDocument;
}

/**
 * Return a value as a plain object, or raise an error pointing to its location.
 *
 * @param value The value to check.
 * @param pointer Location of the value in the document.
 * @returns The value, typed as a plain object.
 * @throws Error If the value is not an object other than an array or `null`.
 */
function expectRecord(value: unknown, pointer: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected an object at ${pointer}`);
  }

  return value as Record<string, unknown>;
}

/**
 * Return an object property that must be an object if present, or an empty object if it is missing.
 *
 * @param parent The object containing the property.
 * @param key The property name.
 * @param pointer Location of the parent object in the document.
 * @returns The property value, or an empty object.
 * @throws Error If the property is present but is not a plain object.
 */
function optionalRecord(parent: Record<string, unknown>, key: string, pointer: string): Record<string, unknown> {
  return Object.hasOwn(parent, key) ? expectRecord(parent[key], `${pointer}/${key}`) : {};
}
