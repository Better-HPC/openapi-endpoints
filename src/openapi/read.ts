/** Reading, parsing, and validation for OpenAPI documents. */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** The contents and file name for an OpenAPI document. */
export interface FileContent {
  /** The document contents. */
  readonly text: string;

  /** The file name without its directory. */
  readonly name: string;
}

/**
 * Read an OpenAPI document from a file path or URL.
 *
 * @param path The file path.
 * @returns The document contents and file name.
 * @throws Error If the file cannot be read.
 */
export function readOpenApiSource(path: string): FileContent {
  return {text: readFileSync(path, "utf8"), name: basename(path)};
}
