/**
 * Command line interface for generating TypeScript definitions from an OpenAPI document.
 *
 * The interface reads a document from a file or URL, generates the TypeScript module,
 * and prints it, writes it to a file, or checks that an existing file is up to date.
 * It is kept separate from the executable entry point so it can be tested without
 * starting a new process.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { parseArgs } from "node:util";

import { isRecord, parseDocument } from "./document.ts";
import { generate } from "./generate.ts";

/** Streams the command line interface writes output and messages to. */
export interface OutputStreams {
  /** Destination for generated code and status messages. */
  readonly stdout: {write(text: string): unknown};

  /** Destination for error messages. */
  readonly stderr: {write(text: string): unknown};
}

/** Exit code for a successful run. */
const EXIT_SUCCESS = 0;

/** Exit code for a failed run, including an output file that is out of date. */
const EXIT_FAILURE = 1;

/** Exit code for invalid command line arguments. */
const EXIT_USAGE = 2;

/** Pattern matching document locations that are downloaded instead of read from disk. */
const REMOTE_SOURCE = /^https?:\/\//i;

/** Help text describing the command line arguments. */
const USAGE = `Usage: openapi-endpoints <schema> [options]

Generate TypeScript model types and a typed endpoint map from an OpenAPI document.

Arguments:
  <schema>             Path or URL of an OpenAPI 3.0 or 3.1 document in YAML or JSON

Options:
  -o, --output <file>  Write the generated module to a file instead of standard output
      --check          Exit with an error if the output file is missing or out of date
  -h, --help           Show this help message
  -v, --version        Show the version number
`;

/**
 * Run the command line interface.
 *
 * @param args The command line arguments, excluding the executable and script paths.
 * @param streams Streams for output and messages.
 * @returns The process exit code.
 */
export async function main(args: readonly string[], streams: OutputStreams = process): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        check: {type: "boolean"},
        help: {type: "boolean", short: "h"},
        output: {type: "string", short: "o"},
        version: {type: "boolean", short: "v"},
      },
    });
  } catch (error) {
    return usageError(streams, messageOf(error));
  }

  const {values, positionals} = parsed;
  if (values.help) {
    streams.stdout.write(USAGE);
    return EXIT_SUCCESS;
  }

  if (values.version) {
    streams.stdout.write(`${await readVersion()}\n`);
    return EXIT_SUCCESS;
  }

  const [source, ...extra] = positionals;
  if (source === undefined) return usageError(streams, "Missing the <schema> argument");
  if (extra.length > 0) return usageError(streams, "Expected a single <schema> argument");
  if (values.check && values.output === undefined) return usageError(streams, "The --check option requires --output");

  try {
    const document = parseDocument(await readSource(source));
    const output = generate(document, {source: REMOTE_SOURCE.test(source) ? source : basename(source)});

    if (values.output === undefined) {
      streams.stdout.write(output);
      return EXIT_SUCCESS;
    }

    if (values.check) {
      return await checkOutput(values.output, output, streams);
    }

    await mkdir(dirname(values.output), {recursive: true});
    await writeFile(values.output, output, "utf8");
    streams.stdout.write(`Wrote ${values.output}\n`);
    return EXIT_SUCCESS;

  } catch (error) {
    streams.stderr.write(`error: ${messageOf(error)}\n`);
    return EXIT_FAILURE;
  }
}

/**
 * Read an OpenAPI document from a file path or an HTTP URL.
 *
 * @param source The file path or URL.
 * @returns The document text.
 * @throws Error If the file cannot be read or the download fails.
 */
async function readSource(source: string): Promise<string> {
  if (!REMOTE_SOURCE.test(source)) {
    return await readFile(source, "utf8");
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Could not download ${source} (HTTP ${response.status})`);
  }

  return await response.text();
}

/**
 * Compare generated code with the contents of an existing output file.
 *
 * @param path The output file path.
 * @param expected The generated code.
 * @param streams Streams for output and messages.
 * @returns `0` if the file matches the generated code, otherwise `1`.
 */
async function checkOutput(path: string, expected: string, streams: OutputStreams): Promise<number> {
  const existing = await readOptionalFile(path);
  if (existing === expected) {
    streams.stdout.write(`${path} is up to date\n`);
    return EXIT_SUCCESS;
  }

  const problem = existing === undefined ? "does not exist" : "is out of date";
  streams.stderr.write(`error: ${path} ${problem}. Run the command without --check to regenerate it.\n`);
  return EXIT_FAILURE;
}

/**
 * Read a text file that may not exist.
 *
 * @param path The file path.
 * @returns The file contents, or `undefined` if the file does not exist.
 */
async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Return the version number of the installed package.
 *
 * @returns The version from `package.json`, or `unknown` if it cannot be read.
 */
async function readVersion(): Promise<string> {
  try {
    const metadata: unknown = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    return isRecord(metadata) && typeof metadata["version"] === "string" ? metadata["version"] : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Report invalid command line arguments.
 *
 * @param streams Streams for output and messages.
 * @param message A description of the problem.
 * @returns The exit code for invalid arguments.
 */
function usageError(streams: OutputStreams, message: string): number {
  streams.stderr.write(`error: ${message}\nRun "openapi-endpoints --help" for usage.\n`);
  return EXIT_USAGE;
}

/**
 * Return a printable message for a thrown value.
 *
 * @param error The thrown value.
 * @returns The error message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
