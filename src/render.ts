/**
 * TypeScript syntax nodes for the generated module, and the printer that renders them.
 *
 * The modules in `generation/` build these nodes instead of writing source text, and
 * `renderModule` turns them into the final module. Keeping text output in one place
 * means unions and intersections are simplified as they are built, and parentheses,
 * indentation, property name quoting, and comment escaping are handled by the printer.
 */

import type { OpenApiInfo } from "./openapi/parse.ts";

/** A TypeScript keyword type used in generated code. */
export type KeywordName = "boolean" | "never" | "null" | "number" | "string" | "unknown" | "void";

/** A value that can be written as a TypeScript literal type. */
export type LiteralValue = string | number | boolean;

/** A property of an object type. */
export interface PropertyNode {
  /** The property name, exactly as it appears in the OpenAPI document. */
  readonly name: string;

  /** The type of the property value. */
  readonly type: TypeNode;

  /** Whether the property may be omitted. */
  readonly optional: boolean;

  /** Lines of the documentation comment written above the property. */
  readonly docs: readonly string[];
}

/** A named type exported by the generated module, described by a type node. */
export interface TypeDeclarationNode {
  /** Discriminator separating declarations built from type nodes and from fixed source. */
  readonly kind: "type";

  /** The name of the declared type. */
  readonly name: string;

  /** The declared type. */
  readonly type: TypeNode;

  /** Lines of the documentation comment written above the declaration. */
  readonly docs: readonly string[];
}

/** A named type exported by the generated module, written as fixed TypeScript source. */
export interface SourceDeclarationNode {
  /** Discriminator separating declarations built from type nodes and from fixed source. */
  readonly kind: "source";

  /** The name of the declared type. */
  readonly name: string;

  /** The TypeScript source of the declaration, including the `export` keyword. */
  readonly source: string;

  /** Lines of the documentation comment written above the declaration. */
  readonly docs: readonly string[];
}

/** A named type exported by the generated module. */
export type DeclarationNode = TypeDeclarationNode | SourceDeclarationNode;

/**
 * A TypeScript type expression.
 *
 * Nodes are never modified after they are created, so the same node can be shared
 * by several declarations.
 */
export type TypeNode =
  | { readonly kind: "keyword"; readonly name: KeywordName }
  | { readonly kind: "literal"; readonly value: LiteralValue }
  | { readonly kind: "reference"; readonly name: string }
  | { readonly kind: "array"; readonly element: TypeNode }
  | { readonly kind: "union"; readonly members: readonly TypeNode[] }
  | { readonly kind: "intersection"; readonly members: readonly TypeNode[] }
  | { readonly kind: "object"; readonly properties: readonly PropertyNode[]; readonly indexType: TypeNode | null };

/** The `boolean` type. */
export const BOOLEAN = keyword("boolean");

/** The `never` type, which has no values. */
export const NEVER = keyword("never");

/** The `null` type. */
export const NULL = keyword("null");

/** The `number` type. */
export const NUMBER = keyword("number");

/** The `string` type. */
export const STRING = keyword("string");

/** The `unknown` type, which accepts any value. */
export const UNKNOWN = keyword("unknown");

/** The `void` type, used for responses without a body. */
export const VOID = keyword("void");

/** Name of the generator, shown in the header comment of generated modules. */
const GENERATOR_NAME = "openapi-endpoints";

/** Section label written above the model types. */
const MODELS_LABEL = "// Model types for the schemas in `components.schemas`";

/** Section label written above the endpoint map and its helper types. */
const ENDPOINTS_LABEL = "// Request and response types for each operation in `paths`, with helper types for looking them up";

/** Indentation used for each nesting level of generated code. */
const INDENT = "  ";

/** Regex matching for property names that can be written without quotes. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Regex matching for canonical non-negative integers, which can be written as unquoted property names. */
const CANONICAL_INTEGER = /^(?:0|[1-9]\d*)$/;

/**
 * Create a literal type.
 *
 * @param value The literal value.
 * @returns The literal type node.
 */
export function literal(value: LiteralValue): TypeNode {
  return {kind: "literal", value};
}

/**
 * Create a reference to a named type.
 *
 * @param name The type name.
 * @returns The reference type node.
 */
export function reference(name: string): TypeNode {
  return {kind: "reference", name};
}

/**
 * Create an array type.
 *
 * @param element The type of the array elements.
 * @returns The array type node.
 */
export function arrayOf(element: TypeNode): TypeNode {
  return {kind: "array", element};
}

/**
 * Create an object type.
 *
 * @param properties The properties of the object.
 * @param indexType The type of values for undeclared keys, or `null` if undeclared keys are not allowed.
 * @returns The object type node.
 */
export function objectOf(properties: readonly PropertyNode[], indexType: TypeNode | null = null): TypeNode {
  return {kind: "object", properties, indexType};
}

/**
 * Create a property of an object type.
 *
 * @param name The property name.
 * @param type The type of the property value.
 * @param optional Whether the property may be omitted.
 * @param docs Lines of the documentation comment written above the property.
 * @returns The property node.
 */
export function property(name: string, type: TypeNode, optional = false, docs: readonly string[] = []): PropertyNode {
  return {name, type, optional, docs};
}

/**
 * Create a declaration of a named type.
 *
 * @param name The name of the declared type.
 * @param type The declared type.
 * @param docs Lines of the documentation comment written above the declaration.
 * @returns The declaration node.
 */
export function declaration(name: string, type: TypeNode, docs: readonly string[] = []): TypeDeclarationNode {
  return {kind: "type", name, type, docs};
}

/**
 * Create a declaration of a named type from fixed TypeScript source.
 *
 * @param name The name of the declared type.
 * @param source The TypeScript source of the declaration, including the `export` keyword.
 * @param docs Lines of the documentation comment written above the declaration.
 * @returns The declaration node.
 */
export function sourceDeclaration(name: string, source: string, docs: readonly string[] = []): SourceDeclarationNode {
  return {kind: "source", name, source, docs};
}

/**
 * Create a union of types, simplified where possible.
 *
 * Nested unions are flattened, duplicate members are removed, and `never` members
 * are dropped. A union containing `unknown` is `unknown`, an empty union is `never`,
 * and a union with a single member is that member.
 *
 * @param members The types to combine.
 * @returns The simplified union type node.
 */
export function union(members: readonly TypeNode[]): TypeNode {
  // Flatten nested unions and check for `unknown`, which absorbs every other member
  const flattened = members.flatMap((member) => member.kind === "union" ? member.members : [member]);
  if (flattened.some((member) => isKeyword(member, "unknown"))) {
    return UNKNOWN;
  }

  // Remove members that do not change the union
  const unique = deduplicate(flattened.filter((member) => !isKeyword(member, "never")));
  const [first, ...rest] = unique;
  if (first === undefined) {
    return NEVER;
  }

  if (rest.length === 0) {
    return first;
  }

  return {kind: "union", members: unique};
}

/**
 * Create an intersection of types, simplified where possible.
 *
 * Nested intersections are flattened, duplicate members are removed, and `unknown`
 * members are dropped. An intersection containing `never` is `never`, an empty
 * intersection is `unknown`, and an intersection with a single member is that member.
 *
 * @param members The types to combine.
 * @returns The simplified intersection type node.
 */
export function intersection(members: readonly TypeNode[]): TypeNode {
  // Flatten nested intersections and check for `never`, which absorbs every other member
  const flattened = members.flatMap((member) => member.kind === "intersection" ? member.members : [member]);
  if (flattened.some((member) => isKeyword(member, "never"))) {
    return NEVER;
  }

  // Remove members that do not change the intersection
  const unique = deduplicate(flattened.filter((member) => !isKeyword(member, "unknown")));
  const [first, ...rest] = unique;
  if (first === undefined) {
    return UNKNOWN;
  }

  if (rest.length === 0) {
    return first;
  }

  return {kind: "intersection", members: unique};
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
  // Collect each distinct, non-blank text as a block of lines
  const blocks: string[][] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (typeof text !== "string") {
      continue;
    }

    const trimmed = text.trim();
    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    blocks.push(trimmed.split(/\r?\n/));
  }

  if (tags.length > 0) {
    blocks.push([...tags]);
  }

  // Join the blocks with a blank line between each one
  return blocks.flatMap((block, index) => index === 0 ? block : ["", ...block]);
}

/**
 * Render the complete TypeScript module for an OpenAPI document.
 *
 * The module contains a header comment, the model types, and the endpoint types, in
 * that order. The model section is omitted if there are no models.
 *
 * @param models The model type declarations.
 * @param endpoints The declarations of the endpoint map and its helper types.
 * @param info Metadata about the API, used for the title and version in the header comment.
 * @param sourceName Name of the source file shown in the header comment.
 * @returns The TypeScript source of the module.
 */
export function renderModule(
  models: readonly DeclarationNode[],
  endpoints: readonly DeclarationNode[],
  info: OpenApiInfo,
  sourceName: string,
): string {
  const blocks = [
    printHeader(info, sourceName),
    ...(models.length > 0 ? [MODELS_LABEL, ...models.map((model) => printDeclaration(model))] : []),
    ENDPOINTS_LABEL,
    ...endpoints.map((endpoint) => printDeclaration(endpoint)),
  ];

  return `${blocks.join("\n\n")}\n`;
}

/**
 * Render the header comment of a generated module.
 *
 * @param info Metadata about the API.
 * @param sourceName Name of the source file.
 * @returns The TypeScript source of the header comment.
 */
function printHeader(info: OpenApiInfo, sourceName: string): string {
  const title = info.title.trim() || "an OpenAPI document";

  return printDocComment([
    `TypeScript definitions for ${title} (version ${info.version}).`,
    "",
    `This module was generated by ${GENERATOR_NAME} from \`${sourceName}\`. Do not edit`,
    "it directly, because changes are lost the next time it is generated.",
  ]);
}

/**
 * Render an exported declaration and its documentation comment.
 *
 * @param declaration The declaration to render.
 * @returns The TypeScript source for the declaration.
 */
function printDeclaration(declaration: DeclarationNode): string {
  const source = declaration.kind === "source" ? declaration.source : printTypeDeclaration(declaration);
  const comment = printDocComment(declaration.docs);
  return comment ? `${comment}\n${source}` : source;
}

/**
 * Render a declaration built from a type node.
 *
 * Object types are declared as interfaces and all other types as type aliases.
 *
 * @param declaration The declaration to render.
 * @returns The TypeScript source for the declaration, without its documentation comment.
 */
function printTypeDeclaration(declaration: TypeDeclarationNode): string {
  const {name, type} = declaration;
  return type.kind === "object"
    ? `export interface ${name} ${printObject(type, 0)}`
    : `export type ${name} = ${printType(type, 0)};`;
}

/**
 * Render a type node as a TypeScript type expression.
 *
 * @param node The type to render.
 * @param depth The nesting level of the expression, used to indent multi-line object types.
 * @returns The TypeScript source for the type.
 */
function printType(node: TypeNode, depth = 0): string {
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
 * Render an object type, using one line per property.
 *
 * @param node The object type to render.
 * @param depth The nesting level of the object type.
 * @returns The TypeScript source for the object type.
 */
function printObject(node: Extract<TypeNode, { kind: "object" }>, depth: number): string {
  if (node.properties.length === 0) {
    return node.indexType ? `{ [key: string]: ${printType(node.indexType, depth)} }` : "{}";
  }

  // Render each property on its own line, preceded by its documentation comment
  const indent = INDENT.repeat(depth + 1);
  const lines = ["{"];
  for (const property of node.properties) {
    const comment = printDocComment(property.docs, depth + 1);
    if (comment) {
      lines.push(comment);
    }

    const name = printPropertyName(property.name) + (property.optional ? "?" : "");
    lines.push(`${indent}${name}: ${printType(property.type, depth + 1)};`);
  }

  if (node.indexType) {
    lines.push(`${indent}[key: string]: ${printType(node.indexType, depth + 1)};`);
  }

  // Close the object at the indentation of the enclosing type
  lines.push(`${INDENT.repeat(depth)}}`);
  return lines.join("\n");
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
 * Render a property name, quoting it if it is not a valid identifier.
 *
 * @param name The property name.
 * @returns The property name as it should appear in an object type.
 */
function printPropertyName(name: string): string {
  return IDENTIFIER.test(name) || CANONICAL_INTEGER.test(name) ? name : JSON.stringify(name);
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
function printDocComment(lines: readonly string[], depth = 0): string {
  // Escape comment terminators and remove surrounding blank lines
  const cleaned = trimBlankLines(lines.map((line) => line.replaceAll("*/", "*\\/").trimEnd()));
  const indent = INDENT.repeat(depth);
  const [first, ...rest] = cleaned;
  if (first === undefined) {
    return "";
  }

  if (rest.length === 0) {
    return `${indent}/** ${first} */`;
  }

  // Write multi-line comments with a leading asterisk on each line
  const body = cleaned.map((line) => line ? `${indent} * ${line}` : `${indent} *`);
  return [`${indent}/**`, ...body, `${indent} */`].join("\n");
}

/**
 * Remove blank lines from the start and end of a list of lines.
 *
 * @param lines The lines to trim.
 * @returns The lines without leading or trailing blank lines.
 */
function trimBlankLines(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => line !== "");
  if (start === -1) {
    return [];
  }

  const end = lines.findLastIndex((line) => line !== "");
  return lines.slice(start, end + 1);
}

/**
 * Create a keyword type.
 *
 * @param name The keyword.
 * @returns The keyword type node.
 */
function keyword(name: KeywordName): TypeNode {
  return {kind: "keyword", name};
}

/**
 * Return whether a node is a specific keyword type.
 *
 * @param node The node to check.
 * @param name The keyword to compare against.
 * @returns Whether the node is the given keyword type.
 */
function isKeyword(node: TypeNode, name: KeywordName): boolean {
  return node.kind === "keyword" && node.name === name;
}

/**
 * Remove structurally identical nodes, keeping the first occurrence of each.
 *
 * @param nodes The nodes to deduplicate.
 * @returns The unique nodes in their original order.
 */
function deduplicate(nodes: readonly TypeNode[]): TypeNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = JSON.stringify(node);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
