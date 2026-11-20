/**
 * Shared helpers for the test suite.
 *
 * Provides generator contexts for converting schemas and endpoints in isolation,
 * access to fixture files, capturing output streams for the command line interface,
 * and a TypeScript compiler wrapper used to confirm generated code type checks.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { validateDocument, type OpenApiDocument } from "../src/document.ts";
import type { OutputStreams } from "../src/main.ts";
import { createModelNames } from "../src/models.ts";
import { printType } from "../src/printer.ts";
import { convertSchema, type GeneratorContext } from "../src/schemas.ts";

/** Output streams that record everything written to them. */
export interface CapturedStreams extends OutputStreams {
  /** Return everything written to standard output. */
  readonly output: () => string;

  /** Return everything written to standard error. */
  readonly errors: () => string;
}

/**
 * Build an OpenAPI document from its paths and components.
 *
 * @param members The document members other than `openapi` and `info`.
 * @returns The OpenAPI document.
 */
export function buildDocument(members: Record<string, unknown> = {}): OpenApiDocument {
  return validateDocument({openapi: "3.0.3", info: {title: "Test API", version: "1.0.0"}, ...members});
}

/**
 * Create a generator context for a document.
 *
 * @param document The document being converted.
 * @returns The generator context, with model names for every schema in the document.
 */
export function createContext(document: OpenApiDocument = buildDocument()): GeneratorContext {
  const components = (document["components"] ?? {}) as Record<string, unknown>;
  const schemas = (components["schemas"] ?? {}) as Record<string, unknown>;
  return {document, modelNames: createModelNames(schemas, new Set())};
}

/**
 * Convert a schema and render the resulting type.
 *
 * @param schema The schema to convert.
 * @param schemas Schemas available for references, keyed by name.
 * @returns The rendered TypeScript type.
 */
export function convert(schema: unknown, schemas: Record<string, unknown> = {}): string {
  const context = createContext(buildDocument({components: {schemas}}));
  return printType(convertSchema(schema, context, "#/test"));
}

/**
 * Return the absolute path of a fixture file.
 *
 * @param name The fixture file name.
 * @returns The absolute path.
 */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
}

/**
 * Read the contents of a fixture file.
 *
 * @param name The fixture file name.
 * @returns The file contents.
 */
export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), "utf8");
}

/**
 * Create output streams that record what is written to them.
 *
 * @returns The streams and accessors for their recorded output.
 */
export function captureStreams(): CapturedStreams {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    stdout: {write: (text: string) => output.push(text)},
    stderr: {write: (text: string) => errors.push(text)},
    output: () => output.join(""),
    errors: () => errors.join(""),
  };
}

/**
 * Create a temporary directory for the duration of a callback.
 *
 * @param callback Receives the directory path and may return a promise.
 * @returns The value returned by the callback.
 */
export async function withTemporaryDirectory<T>(callback: (directory: string) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "openapi-endpoints-"));
  try {
    return await callback(directory);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}

/**
 * Type check a set of TypeScript modules with strict compiler settings.
 *
 * @param files Module sources keyed by file name, such as `api.ts`.
 * @returns The formatted compiler diagnostics, which are empty if the modules type check.
 */
export async function typeCheck(files: Record<string, string>): Promise<string[]> {
  return await withTemporaryDirectory((directory) => {
    const paths = Object.entries(files).map(([name, source]) => {
      const path = join(directory, name);
      writeFileSync(path, source, "utf8");
      return path;
    });

    const program = ts.createProgram(paths, {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      types: [],
    });

    return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (!diagnostic.file || diagnostic.start === undefined) return message;

      const {line} = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName.slice(directory.length + 1)}:${line + 1}: ${message}`;
    });
  });
}
