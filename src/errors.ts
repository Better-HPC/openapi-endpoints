/** Custom application errors designed to provide useful error messaging. */

/** An error raised when an OpenAPI document cannot be parsed or converted into TypeScript definitions. */
export class GenerationError extends Error {
  /** JSON pointer to the location in the document causing the error. */
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
