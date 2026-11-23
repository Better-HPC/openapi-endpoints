/**
 * Top level pipeline for generating TypeScript definitions from an OpenAPI document.
 *
 * The `main` function defines the top level application logic and is responsible for
 * executing application steps in order. The logic behind each step is abstracted into
 * submodules which report problems by throwing errors. The outputs and errors of each
 * step are handled here to determine the final exit code.
 */

import { parseArguments } from "./cli.ts";
import { parseDocument } from "./document.ts";
import { convertEndpoints } from "./endpoints.ts";
import { convertModels } from "./models.ts";
import { assignModelNames } from "./naming.ts";
import { checkOutput, type OutputStreams, reportError, writeOutput } from "./output.ts";
import { printModule } from "./printer.ts";
import { readSource } from "./source.ts";

/** Exit code for a successful run. */
const EXIT_SUCCESS = 0;

/** Exit code for a failed run (including a failed schema check). */
const EXIT_FAILURE = 1;

/**
 * Generate TypeScript definitions from an OpenAPI document as described by the command line arguments.
 *
 * @param args The command line arguments, excluding the executable and script paths.
 * @param streams Streams for generated code and messages.
 * @returns The process exit code.
 */
export function main(args: readonly string[], streams: OutputStreams = process): number {
  const parsedArgs = parseArguments(args);

  try {
    const source = readSource(parsedArgs.schema);
    const document = parseDocument(source.text);

    // Type names are assigned first because both conversions refer to models by name
    const modelNames = assignModelNames(document);
    const models = convertModels(document, modelNames);
    const endpoints = convertEndpoints(document, modelNames);
    const code = printModule(document, models, endpoints, source.name);

    if (parsedArgs.action === "check") {
      const upToDate = checkOutput(code, parsedArgs.output, streams);
      return upToDate ? EXIT_SUCCESS : EXIT_FAILURE;
    }

    writeOutput(code, parsedArgs.output, streams);
    return EXIT_SUCCESS;

  } catch (error) {
    reportError(error, streams);
    return EXIT_FAILURE;
  }
}
