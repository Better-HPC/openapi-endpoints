/** Reading, parsing, and validation for OpenAPI documents. */

import { parse } from "yaml";

import { GenerationError } from "./errors.ts";
import { expectRecord, OpenApiDocument, pointerTo } from "../navigation.ts";

/** Regex matching the supported OpenAPI versions. */
const SUPPORTED_VERSION = /^3\.[01](?:\.\d+)?$/;

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

/**
 * Confirm the given text is a valid OpenAPI specification.
 *
 * @param value The text to validate.
 * @returns The input `value`, typed as an OpenAPI document.
 * @throws GenerationError If the `value` is not a valid OpenAPI specification.
 */
function validateDocument(value: unknown): OpenApiDocument {
  const document = expectRecord(value, "#");
  const version = document["openapi"];

  if (typeof version !== "string" || !SUPPORTED_VERSION.test(version)) {
    throw new GenerationError("The provided OpenAPI version is not supported", pointerTo("#", "openapi"));
  }

  return document as OpenApiDocument;
}
