/**
 * Parsing and validation of OpenAPI documents.
 *
 * Documents are parsed from YAML or JSON and validated just enough to confirm they
 * use a supported OpenAPI version. The rest of the document is treated as untrusted
 * input and checked by the later steps as they read it.
 */

import { parse } from "yaml";

import { GenerationError } from "./errors.ts";
import { expectRecord, pointerTo, type OpenApiDocument } from "./navigation.ts";

/** Pattern matching the OpenAPI versions supported by the generator. */
const SUPPORTED_VERSION = /^3\.[01](?:\.\d+)?$/;

/**
 * Parse an OpenAPI document from YAML or JSON text.
 *
 * JSON is a subset of YAML, so both formats are read by the same parser.
 *
 * @param text The document contents.
 * @returns The parsed and validated document.
 * @throws GenerationError If the text cannot be parsed or is not an OpenAPI 3.0 or 3.1 document.
 */
export function parseDocument(text: string): OpenApiDocument {
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
 * Confirm a parsed value is an OpenAPI 3.0 or 3.1 document.
 *
 * @param value The parsed document.
 * @returns The value, typed as an OpenAPI document.
 * @throws GenerationError If the value is not an OpenAPI 3.0 or 3.1 document.
 */
export function validateDocument(value: unknown): OpenApiDocument {
  const document = expectRecord(value, "#");
  const version = document["openapi"];
  if (typeof version !== "string" || !SUPPORTED_VERSION.test(version)) {
    throw new GenerationError("Only OpenAPI 3.0 and 3.1 documents are supported", pointerTo("#", "openapi"));
  }

  return document as OpenApiDocument;
}
