/**
 * Utilities for reading and navigating OpenAPI documents.
 *
 * Documents are parsed from YAML or JSON and validated just enough to confirm they
 * use a supported OpenAPI version. The rest of the document is treated as untrusted
 * input and checked as it is read, with problems reported as a `GenerationError`
 * that points to the offending location.
 */

import { parse } from "yaml";

import { GenerationError } from "./errors.ts";

/** A parsed OpenAPI 3.0 or 3.1 document. */
export interface OpenApiDocument {
  /** The version of the OpenAPI specification used by the document. */
  readonly openapi: string;

  readonly [key: string]: unknown;
}

/** A section of `components` that can be the target of a reference. */
export type ComponentSection = "parameters" | "requestBodies" | "responses" | "schemas";

/** A document object with any references to other components resolved. */
export interface ResolvedObject {
  /** The resolved object. */
  readonly value: Record<string, unknown>;

  /** JSON pointer to the resolved object. */
  readonly pointer: string;
}

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

/**
 * Return whether a value is a plain object, as produced by parsing YAML or JSON.
 *
 * @param value The value to check.
 * @returns Whether the value is an object other than an array or `null`.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Return whether an object defines a property itself, ignoring inherited properties.
 *
 * @param record The object to check.
 * @param key The property name.
 * @returns Whether the object has its own property with the given name.
 */
export function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

/**
 * Return a value as a plain object, or raise an error pointing to its location.
 *
 * @param value The value to check.
 * @param pointer JSON pointer to the value.
 * @returns The value, typed as a plain object.
 * @throws GenerationError If the value is not a plain object.
 */
export function expectRecord(value: unknown, pointer: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new GenerationError("Expected an object", pointer);
  }

  return value;
}

/**
 * Return an object property that must be an object if present, or an empty object if it is missing.
 *
 * @param parent The object containing the property.
 * @param key The property name.
 * @param pointer JSON pointer to the parent object.
 * @returns The property value, or an empty object.
 * @throws GenerationError If the property is present but is not a plain object.
 */
export function optionalRecord(parent: Record<string, unknown>, key: string, pointer: string): Record<string, unknown> {
  return hasOwn(parent, key) ? expectRecord(parent[key], pointerTo(pointer, key)) : {};
}

/**
 * Build a JSON pointer by appending segments to an existing pointer.
 *
 * @param base The pointer to extend, such as `#` for the document root.
 * @param segments The property names or array indexes to append.
 * @returns The extended pointer with each segment escaped.
 */
export function pointerTo(base: string, ...segments: readonly (string | number)[]): string {
  return base + segments.map((segment) => `/${escapePointerSegment(String(segment))}`).join("");
}

/**
 * Return the component name targeted by a local `$ref` value.
 *
 * @param ref The reference value, such as `#/components/schemas/Team`.
 * @param section The components section the reference must point into.
 * @param pointer JSON pointer to the reference value.
 * @returns The unescaped component name.
 * @throws GenerationError If the reference does not point to a component in the given section.
 */
export function componentName(ref: unknown, section: ComponentSection, pointer: string): string {
  const prefix = `#/components/${section}/`;
  if (typeof ref !== "string" || !ref.startsWith(prefix)) {
    throw new GenerationError(`Only references to "#/components/${section}" are supported here`, pointer);
  }

  const segment = ref.slice(prefix.length);
  if (segment === "" || segment.includes("/")) {
    throw new GenerationError(`Unsupported reference ${JSON.stringify(ref)}`, pointer);
  }

  // References are URI fragments, so component names may also be percent-encoded
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new GenerationError(`Malformed reference ${JSON.stringify(ref)}`, pointer);
  }

  return unescapePointerSegment(decoded);
}

/**
 * Return a document object, following `$ref` values until a concrete object is found.
 *
 * @param document The document containing the object.
 * @param value The object, which may be a reference object.
 * @param section The components section references must point into.
 * @param pointer JSON pointer to the object.
 * @returns The resolved object and its location.
 * @throws GenerationError If a reference is unsupported, unresolvable, or circular.
 */
export function resolveObject(
  document: OpenApiDocument,
  value: unknown,
  section: ComponentSection,
  pointer: string,
): ResolvedObject {
  const entries = optionalRecord(optionalRecord(document, "components", "#"), section, "#/components");
  const visited = new Set<string>();

  let current = expectRecord(value, pointer);
  let location = pointer;
  while (hasOwn(current, "$ref")) {
    const refPointer = pointerTo(location, "$ref");
    const name = componentName(current["$ref"], section, refPointer);
    if (visited.has(name)) {
      throw new GenerationError(`Circular reference to ${JSON.stringify(current["$ref"])}`, refPointer);
    }

    if (!hasOwn(entries, name)) {
      throw new GenerationError(`Reference ${JSON.stringify(current["$ref"])} does not match any component`, refPointer);
    }

    visited.add(name);
    location = pointerTo(`#/components/${section}`, name);
    current = expectRecord(entries[name], location);
  }

  return {value: current, pointer: location};
}

/**
 * Escape a property name for use as a JSON pointer segment.
 *
 * @param segment The property name.
 * @returns The escaped segment.
 */
function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * Convert a JSON pointer segment back into the property name it represents.
 *
 * @param segment The escaped segment.
 * @returns The property name.
 */
function unescapePointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}
