/**
 * Command line arguments and the help and version commands.
 *
 * Arguments are parsed into a `Command` describing what the rest of the run should
 * do: print the help text, print the version number, or generate a module and either
 * write it out or check it against an existing file. Invalid arguments raise a
 * `UsageError`, so the caller can exit with a distinct status.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { UsageError } from "./errors.ts";
import { isRecord } from "./navigation.ts";
import type { OutputStreams } from "./output.ts";

/**
 * The action requested by the command line arguments.
 *
 * The `generate` command writes the module to the `output` file, or to standard output
 * if no file is given. The `check` command compares the module with the existing
 * `output` file instead of writing it.
 */
export type Command =
  | {readonly kind: "help"}
  | {readonly kind: "version"}
  | {readonly kind: "generate"; readonly schema: string; readonly output: string | undefined}
  | {readonly kind: "check"; readonly schema: string; readonly output: string};

/** Help text describing the command line arguments. */
const USAGE = `Usage: openapi-endpoints <schema> [options]

Generate TypeScript model types and a typed endpoint map from an OpenAPI document.

Arguments:
  <schema>             Path of an OpenAPI 3.0 or 3.1 document in YAML or JSON

Options:
  -o, --output <file>  Write the generated module to a file instead of standard output
      --check          Exit with an error if the output file is missing or out of date
  -h, --help           Show this help message
  -v, --version        Show the version number
`;

/**
 * Parse the command line arguments into the requested command.
 *
 * The help and version options take precedence over missing or extra arguments.
 *
 * @param args The command line arguments, excluding the executable and script paths.
 * @returns The requested command.
 * @throws UsageError If the arguments are invalid.
 */
export function parseArguments(args: readonly string[]): Command {
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
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const {values, positionals} = parsed;
  if (values.help) return {kind: "help"};
  if (values.version) return {kind: "version"};

  const [schema, ...extra] = positionals;
  if (schema === undefined) throw new UsageError("Missing the <schema> argument");
  if (extra.length > 0) throw new UsageError("Expected a single <schema> argument");
  if (!values.check) return {kind: "generate", schema, output: values.output};

  if (values.output === undefined) throw new UsageError("The --check option requires --output");
  return {kind: "check", schema, output: values.output};
}

/**
 * Print the help text describing the command line arguments.
 *
 * @param streams Streams for output and messages.
 */
export function printUsage(streams: OutputStreams): void {
  streams.stdout.write(USAGE);
}

/**
 * Print the version number of the installed package.
 *
 * @param streams Streams for output and messages.
 */
export function printVersion(streams: OutputStreams): void {
  streams.stdout.write(`${readVersion()}\n`);
}

/**
 * Return the version number of the installed package.
 *
 * @returns The version from `package.json`, or `unknown` if it cannot be read.
 */
function readVersion(): string {
  try {
    const metadata: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return isRecord(metadata) && typeof metadata["version"] === "string" ? metadata["version"] : "unknown";
  } catch {
    return "unknown";
  }
}
