/**
 * Error types raised while generating TypeScript definitions.
 *
 * Problems with an OpenAPI document are reported with a JSON pointer to the location
 * that caused them, so the offending definition can be found quickly in large
 * documents.
 */

/** An error raised when an OpenAPI document cannot be converted into TypeScript definitions. */
export class GenerationError extends Error {
  /** JSON pointer to the location in the document that caused the error. */
  readonly pointer: string;

  /**
   * Create an error describing a problem at a location in an OpenAPI document.
   *
   * @param message A description of the problem.
   * @param pointer JSON pointer to the location of the problem.
   */
  constructor(message: string, pointer: string) {
    super(`${message} at ${pointer}`);
    this.name = "GenerationError";
    this.pointer = pointer;
  }
}
