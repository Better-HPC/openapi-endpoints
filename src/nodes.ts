/**
 * Syntax nodes describing the TypeScript types and declarations emitted by the generator.
 *
 * The conversion steps produce these nodes rather than strings, so unions and
 * intersections can be flattened and deduplicated as they are built, and so
 * parentheses, indentation, and comments are handled in one place by the printer.
 * Declarations that rely on features the type nodes do not describe, such as generic
 * parameters and conditional types, carry fixed TypeScript source instead. Nodes are
 * plain objects and are never modified after they are created.
 */

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

/** A TypeScript type expression. */
export type TypeNode =
  | {readonly kind: "keyword"; readonly name: KeywordName}
  | {readonly kind: "literal"; readonly value: LiteralValue}
  | {readonly kind: "reference"; readonly name: string}
  | {readonly kind: "array"; readonly element: TypeNode}
  | {readonly kind: "union"; readonly members: readonly TypeNode[]}
  | {readonly kind: "intersection"; readonly members: readonly TypeNode[]}
  | {readonly kind: "object"; readonly properties: readonly PropertyNode[]; readonly indexType: TypeNode | null};

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

/**
 * Create a keyword type.
 *
 * @param name The keyword.
 * @returns The keyword type node.
 */
export function keyword(name: KeywordName): TypeNode {
  return {kind: "keyword", name};
}

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
  const flattened = members.flatMap((member) => member.kind === "union" ? member.members : [member]);
  if (flattened.some((member) => isKeyword(member, "unknown"))) {
    return UNKNOWN;
  }

  const unique = deduplicate(flattened.filter((member) => !isKeyword(member, "never")));
  const [first, ...rest] = unique;
  if (first === undefined) return NEVER;
  if (rest.length === 0) return first;
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
  const flattened = members.flatMap((member) => member.kind === "intersection" ? member.members : [member]);
  if (flattened.some((member) => isKeyword(member, "never"))) {
    return NEVER;
  }

  const unique = deduplicate(flattened.filter((member) => !isKeyword(member, "unknown")));
  const [first, ...rest] = unique;
  if (first === undefined) return UNKNOWN;
  if (rest.length === 0) return first;
  return {kind: "intersection", members: unique};
}

/**
 * Return whether a node is a specific keyword type.
 *
 * @param node The node to check.
 * @param name The keyword to compare against.
 * @returns Whether the node is the given keyword type.
 */
export function isKeyword(node: TypeNode, name: KeywordName): boolean {
  return node.kind === "keyword" && node.name === name;
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
 * Remove structurally identical nodes, keeping the first occurrence of each.
 *
 * @param nodes The nodes to deduplicate.
 * @returns The unique nodes in their original order.
 */
function deduplicate(nodes: readonly TypeNode[]): TypeNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = JSON.stringify(node);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
