/** Fetching and reading OpenAPI documents. */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** Contents and metadata for a text file. */
export interface FileContent {
  /** The file contents. */
  readonly text: string;

  /** The file base name. */
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
