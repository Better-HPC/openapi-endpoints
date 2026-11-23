/**
 * Top level pipeline for generating TypeScript definitions from an OpenAPI document.
 *
 * The `main` function defines the top level application logic and is responsible for
 * executing application steps in order. The logic behind each step is abstracted into
 * submodules which report problems by throwing errors. The outputs and errors of each
 * step are handled here to determine the final exit code.
 */

import { parseArguments, printUsage, printVersion } from "./arguments.ts";
import { parseDocument } from "./document.ts";
import { convertEndpoints } from "./endpoints.ts";
import { UsageError } from "./errors.ts";
import { convertModels } from "./models.ts";
import { assignModelNames } from "./naming.ts";
import { checkOutput, type OutputStreams, reportError, writeOutput } from "./output.ts";
import { printModule } from "./printer.ts";
import { readSource } from "./source.ts";

/** Exit code for a successful run. */
const EXIT_SUCCESS = 0;

/** Exit code for a failed run (including a failed schema check). */
const EXIT_FAILURE = 1;

/** Exit code for invalid command line arguments. */
const EXIT_USAGE = 2;

/**
 * Generate TypeScript definitions from an OpenAPI document as described by the command line arguments.
 *
 * @param args The command line arguments, excluding the executable and script paths.
 * @param streams Streams for generated code and messages.
 * @returns The process exit code.
 */
export function main(args: readonly string[], streams: OutputStreams = process): number {
  try {
    const command = parseArguments(args);
    if (command.kind === "help") {
      printUsage(streams);
      return EXIT_SUCCESS;
    }

    if (command.kind === "version") {
      printVersion(streams);
      return EXIT_SUCCESS;
    }

    const source = readSource(command.schema);
    const document = parseDocument(source.text);

    // Type names are assigned first because both conversions refer to models by name
    const modelNames = assignModelNames(document);
    const models = convertModels(document, modelNames);
    const endpoints = convertEndpoints(document, modelNames);
    const code = printModule(document, models, endpoints, source.name);

    if (command.kind === "check") {
      const upToDate = checkOutput(code, command.output, streams);
      return upToDate ? EXIT_SUCCESS : EXIT_FAILURE;
    }

    writeOutput(code, command.output, streams);
    return EXIT_SUCCESS;

  } catch (error) {
    reportError(error, streams);
    return error instanceof UsageError ? EXIT_USAGE : EXIT_FAILURE;
  }
}
