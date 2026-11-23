/**
 * Top level pipeline for generating TypeScript definitions from an OpenAPI document.
 *
 * The `main` function defines the top level application logic and is responsible for
 * executing application steps in order. The logic behind each step is abstracted into
 * submodules which report problems by throwing errors. The outputs and errors of each
 * step are handled here to determine the final exit code.
 */

import { parseArguments } from "./cli.ts";
import { parseOpenApiText, readOpenApiSource } from "./document.ts";
import { convertEndpoints } from "./endpoints.ts";
import { convertModels } from "./models.ts";
import { deriveModelNames } from "./naming.ts";
import { checkOutput, type OutputStreams, reportError, writeOutput } from "./output.ts";
import { printModule } from "./printer.ts";

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
    const openApiSource = readOpenApiSource(parsedArgs.schema);
    const openApiSpec = parseOpenApiText(openApiSource.text);

    const modelNameMap = deriveModelNames(openApiSpec);
    const models = convertModels(openApiSpec, modelNameMap);
    const endpoints = convertEndpoints(openApiSpec, modelNameMap);
    const code = printModule(openApiSpec, models, endpoints, openApiSource.name);

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
