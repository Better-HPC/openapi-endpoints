/**
 * Reading of OpenAPI documents from disk.
 *
 * The document text is returned together with the name of the file it came from,
 * which the printer shows in the header comment of the generated module. Only the
 * file name is kept, so the header does not depend on the directory the command is
 * run from.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** The text of an OpenAPI document and the name of the file it was read from. */
export interface SourceText {
  /** The document contents. */
  readonly text: string;

  /** The file name without its directory, shown in the header comment of the generated module. */
  readonly name: string;
}

/**
 * Read an OpenAPI document from a file.
 *
 * @param path The file path.
 * @returns The document text and file name.
 * @throws Error If the file cannot be read.
 */
export function readSource(path: string): SourceText {
  return {text: readFileSync(path, "utf8"), name: basename(path)};
}
