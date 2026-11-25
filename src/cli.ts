/** Command line interface definitions and argument parsing logic. */

import { createCommand } from "commander";

import pkg from "../package.json" with { type: "json" };

/** The action requested by the command line arguments. */
export type ParsingResult =
  | { readonly action: "generate"; readonly schema: string; readonly output: string | undefined }
  | { readonly action: "check"; readonly schema: string; readonly output: string };

/**
 * Parse the command line arguments into the requested command.
 *
 * When asked for the help text or version number, the value is printed and the process exits.
 * Invalid arguments are reported the same way but with an error message and a failing exit code.
 *
 * @param args The command line arguments to parse.
 * @returns The parsed results formatted to indicate the desired application behavior.
 */
export function parseArguments(args: readonly string[]): ParsingResult {
  // Define the application interface
  const command = createCommand("openapi-endpoints")
    .description("Generate TypeScript model types from an OpenAPI specification.")
    .helpOption("-h, --help", "Show the application help text")
    .version(pkg.version, "-v, --version", "Show the application version number")
    .argument("<schema>", "Path or URL of an OpenAPI specification in YAML or JSON format")
    .option("-o, --output <file>", "Write the generated module to a file instead of STDOUT")
    .option("--check", "Exit with an error if the output file is missing or out of date")
    .parse([...args], {from: "user"});

  // Parse and collect arguments
  const schema: string = command.processedArgs[0];
  const {output, check} = command.opts<{ output?: string; check?: boolean }>();

  // Validate parsed arguments
  if (check && output === undefined) {
    command.error("error: option '--check' requires option '--output <file>'");
  }

  // Format and return parsed results
  const action = check ? "check" : "generate";
  return {action, schema, output} as ParsingResult;
}
