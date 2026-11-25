/**
 * Delivery of generated code and messages to the user.
 *
 * Generated code is written to standard output, written to a file, or compared with
 * an existing file to confirm it is up to date. Errors raised by any step are reported
 * here as well, so apart from the messages commander prints while parsing arguments,
 * every message the command prints comes from this module.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Streams the command line interface writes output and messages to. */
export interface OutputStreams {
  /** Destination for generated code and status messages. */
  readonly stdout: { write(text: string): unknown };

  /** Destination for error messages. */
  readonly stderr: { write(text: string): unknown };
}

/**
 * Write generated code to a file, or to standard output if no file is given.
 *
 * Missing parent directories of the file are created.
 *
 * @param code The generated code.
 * @param path The output file path, or `undefined` to write to standard output.
 * @param streams Streams for output and messages.
 */
export function writeOutput(code: string, path: string | undefined, streams: OutputStreams): void {
  if (path === undefined) {
    streams.stdout.write(code);
    return;
  }

  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, code, "utf8");
  streams.stdout.write(`Wrote ${path}\n`);
}

/**
 * Compare generated code with the contents of an existing output file.
 *
 * @param code The generated code.
 * @param path The output file path.
 * @param streams Streams for output and messages.
 * @returns Whether the file exists and matches the generated code.
 */
export function checkOutput(code: string, path: string, streams: OutputStreams): boolean {
  const existing = readOptionalFile(path);
  if (existing === code) {
    streams.stdout.write(`${path} is up to date\n`);
    return true;
  }

  const problem = existing === undefined ? "does not exist" : "is out of date";
  streams.stderr.write(`error: ${path} ${problem}. Run the command without --check to regenerate it.\n`);
  return false;
}

/**
 * Report an error raised by any step of the command.
 *
 * @param error The thrown value.
 * @param streams Streams for output and messages.
 */
export function reportError(error: unknown, streams: OutputStreams): void {
  const message = error instanceof Error ? error.message : String(error);
  streams.stderr.write(`error: ${message}\n`);
}

/**
 * Read a text file that may not exist.
 *
 * @param path The file path.
 * @returns The file contents, or `undefined` if the file does not exist.
 */
function readOptionalFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}
