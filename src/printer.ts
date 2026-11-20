/**
 * Rendering of type nodes and documentation comments as TypeScript source text.
 *
 * The printer is the only part of the generator that produces source text. It adds
 * parentheses where operator precedence requires them, quotes property names that
 * are not valid identifiers, indents nested object types, and escapes documentation
 * text so it cannot terminate a comment early.
 */

import type { LiteralValue, TypeNode } from "./nodes.ts";

/** Indentation used for each nesting level of generated code. */
const INDENT = "  ";

/** Pattern matching property names that can be written without quotes. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Pattern matching canonical non-negative integers, which can be written as unquoted property names. */
const CANONICAL_INTEGER = /^(?:0|[1-9]\d*)$/;

/**
 * Render a type node as a TypeScript type expression.
 *
 * @param node The type to render.
 * @param depth The nesting level of the expression, used to indent multi-line object types.
 * @returns The TypeScript source for the type.
 */
export function printType(node: TypeNode, depth = 0): string {
  switch (node.kind) {
    case "keyword":
      return node.name;
    case "literal":
      return printLiteral(node.value);
    case "reference":
      return node.name;
    case "array":
      return `${printOperand(node.element, depth)}[]`;
    case "union":
      return node.members.map((member) => printType(member, depth)).join(" | ");
    case "intersection":
      return node.members
        .map((member) => member.kind === "union" ? `(${printType(member, depth)})` : printType(member, depth))
        .join(" & ");
    case "object":
      return printObject(node, depth);
  }
}

/**
 * Render an exported declaration for a named type.
 *
 * Object types are declared as interfaces and all other types as type aliases.
 *
 * @param name The name of the declared type.
 * @param node The type to declare.
 * @param docs Lines of the documentation comment written above the declaration.
 * @returns The TypeScript source for the declaration.
 */
export function printDeclaration(name: string, node: TypeNode, docs: readonly string[] = []): string {
  const declaration = node.kind === "object"
    ? `export interface ${name} ${printObject(node, 0)}`
    : `export type ${name} = ${printType(node, 0)};`;

  const comment = printDocComment(docs);
  return comment ? `${comment}\n${declaration}` : declaration;
}

/**
 * Render a documentation comment.
 *
 * Leading and trailing blank lines are removed, and any `*\/` sequence in the text is
 * escaped. A single line is rendered as a one-line comment.
 *
 * @param lines The lines of the comment.
 * @param depth The nesting level of the comment, used for indentation.
 * @returns The TypeScript source for the comment, or an empty string if there are no lines.
 */
export function printDocComment(lines: readonly string[], depth = 0): string {
  const cleaned = trimBlankLines(lines.map((line) => line.replaceAll("*/", "*\\/").trimEnd()));
  const indent = INDENT.repeat(depth);
  const [first, ...rest] = cleaned;
  if (first === undefined) return "";
  if (rest.length === 0) return `${indent}/** ${first} */`;

  const body = cleaned.map((line) => line ? `${indent} * ${line}` : `${indent} *`);
  return [`${indent}/**`, ...body, `${indent} */`].join("\n");
}

/**
 * Render a property name, quoting it if it is not a valid identifier.
 *
 * @param name The property name.
 * @returns The property name as it should appear in an object type.
 */
export function printPropertyName(name: string): string {
  return IDENTIFIER.test(name) || CANONICAL_INTEGER.test(name) ? name : JSON.stringify(name);
}

/**
 * Combine descriptive text and tags into the lines of a documentation comment.
 *
 * Text values that are not strings, are blank, or repeat an earlier value are skipped.
 * Each remaining text and the block of tags are separated by a blank line.
 *
 * @param texts Candidate descriptions, such as a summary followed by a longer description.
 * @param tags Documentation tags, such as `@deprecated`.
 * @returns The lines of the documentation comment.
 */
export function buildDocs(texts: readonly unknown[], tags: readonly string[] = []): string[] {
  const blocks: string[][] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (typeof text !== "string") continue;

    const trimmed = text.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;

    seen.add(trimmed);
    blocks.push(trimmed.split(/\r?\n/));
  }

  if (tags.length > 0) blocks.push([...tags]);
  return blocks.flatMap((block, index) => index === 0 ? block : ["", ...block]);
}

/**
 * Render a type that is used as an operand of the array operator.
 *
 * @param node The type to render.
 * @param depth The nesting level of the expression.
 * @returns The TypeScript source, wrapped in parentheses if required.
 */
function printOperand(node: TypeNode, depth: number): string {
  const source = printType(node, depth);
  return node.kind === "union" || node.kind === "intersection" ? `(${source})` : source;
}

/**
 * Render a literal type.
 *
 * @param value The literal value.
 * @returns The TypeScript source for the literal.
 */
function printLiteral(value: LiteralValue): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * Render an object type, using one line per property.
 *
 * @param node The object type to render.
 * @param depth The nesting level of the object type.
 * @returns The TypeScript source for the object type.
 */
function printObject(node: Extract<TypeNode, {kind: "object"}>, depth: number): string {
  if (node.properties.length === 0) {
    return node.indexType ? `{ [key: string]: ${printType(node.indexType, depth)} }` : "{}";
  }

  const indent = INDENT.repeat(depth + 1);
  const lines = ["{"];
  for (const property of node.properties) {
    const comment = printDocComment(property.docs, depth + 1);
    if (comment) lines.push(comment);

    const name = printPropertyName(property.name) + (property.optional ? "?" : "");
    lines.push(`${indent}${name}: ${printType(property.type, depth + 1)};`);
  }

  if (node.indexType) {
    lines.push(`${indent}[key: string]: ${printType(node.indexType, depth + 1)};`);
  }

  lines.push(`${INDENT.repeat(depth)}}`);
  return lines.join("\n");
}

/**
 * Remove blank lines from the start and end of a list of lines.
 *
 * @param lines The lines to trim.
 * @returns The lines without leading or trailing blank lines.
 */
function trimBlankLines(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => line !== "");
  if (start === -1) return [];

  const end = lines.findLastIndex((line) => line !== "");
  return lines.slice(start, end + 1);
}
