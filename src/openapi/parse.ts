/** Reading, parsing, and validation for OpenAPI documents. */

import { parse } from "yaml";

import { GenerationError } from "../errors.ts";
import { expectRecord, pointerTo } from "../navigation.ts";

/** Regex matching the supported OpenAPI versions. */
const SUPPORTED_VERSION = /^3\.[01](?:\.\d+)?$/;

/** A parsed OpenAPI 3.0 or 3.1 document. */
export interface OpenApiDocument {
  /** The version of the OpenAPI specification used by the document. */
  readonly openapi: string;

  /** Metadata about the API, such as its title and version. */
  readonly info?: unknown;

  /** The default JSON Schema dialect for schemas in the document (OpenAPI 3.1 only). */
  readonly jsonSchemaDialect?: unknown;

  /** Operations available on each path, keyed by path template. */
  readonly paths?: unknown;

  /** Requests the API may send to the client, keyed by name (OpenAPI 3.1 only). */
  readonly webhooks?: unknown;

  /** Reusable objects that other parts of the document can reference. */
  readonly components?: unknown;

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
 * Confirm a file parsing result is a valid OpenAPI document with a supported version.
 *
 * The following properties are checked:
 *
 * - The value is an object.
 * - The `openapi` property is a string.
 * - The `openapi` property matches a supported version.
 *
 * @param value The value parsed from the document text.
 * @returns The input value, typed as an OpenAPI document.
 * @throws GenerationError If the value is not a valid OpenAPI specification.
 */
function validateDocument(value: unknown): OpenApiDocument {
  const document = expectRecord(value, "#");
  const version = document["openapi"];

  if (typeof version !== "string" || !SUPPORTED_VERSION.test(version)) {
    throw new GenerationError("The provided OpenAPI version is not supported", pointerTo("#", "openapi"));
  }

  return document as OpenApiDocument;
}

/**
 * Parse the YAML or JSON text from an OpenAPI specification.
 *
 * @param text The text of an OpenAPI specification.
 * @returns The parsed and validated content.
 * @throws GenerationError If the input cannot be parsed.
 */
export function parseOpenApiText(text: string): OpenApiDocument {
  let value: unknown;
  try {
    value = parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new GenerationError(`The document is not valid YAML or JSON: ${reason}`, "#");
  }

  return validateDocument(value);
}
