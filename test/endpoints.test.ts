/** Unit tests for the `buildEndpoints` function. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEndpoints } from "../src/generation/endpoints.ts";
import type { PropertyNode, TypeNode } from "../src/nodes.ts";
import { printType } from "../src/generation/render.ts";
import { buildDocument, createContext } from "./support.ts";

/** A part of an operation in the endpoint map. */
type OperationPart = "body" | "path" | "query" | "response" | "responses";

/** A JSON response containing a team. */
const TEAM_RESPONSE = {
  description: "",
  content: {"application/json": {schema: {$ref: "#/components/schemas/Team"}}},
};

/** Components shared by the test documents. */
const COMPONENTS = {
  schemas: {
    Team: {type: "object", properties: {id: {type: "integer"}}, required: ["id"]},
  },
};

/**
 * Return the property with the given name from an object type node.
 *
 * @param node The object type node.
 * @param name The property name.
 * @returns The property.
 */
function findProperty(node: TypeNode, name: string): PropertyNode {
  assert.equal(node.kind, "object", `Expected an object type containing ${name}`);
  const match = node.kind === "object" ? node.properties.find((property) => property.name === name) : undefined;
  assert.ok(match, `Expected a property named ${name}`);
  return match;
}

/**
 * Return the property names of an object type node in order.
 *
 * @param node The object type node.
 * @returns The property names.
 */
function propertyNames(node: TypeNode): string[] {
  assert.equal(node.kind, "object", "Expected an object type");
  return node.kind === "object" ? node.properties.map((property) => property.name) : [];
}

/**
 * Build the endpoint map for a document and return one operation.
 *
 * @param paths The `paths` object of the document.
 * @param path The path of the operation.
 * @param method The HTTP method of the operation.
 * @returns The operation property.
 */
function findOperation(paths: Record<string, unknown>, path: string, method: string): PropertyNode {
  const endpoints = buildEndpoints(createContext(buildDocument({paths, components: COMPONENTS})));
  return findProperty(findProperty(endpoints, path).type, method);
}

/**
 * Build the endpoint map for a document and render one part of an operation.
 *
 * @param paths The `paths` object of the document.
 * @param path The path of the operation.
 * @param method The HTTP method of the operation.
 * @param part The part of the operation to render.
 * @returns The rendered TypeScript type of the part.
 */
function renderPart(paths: Record<string, unknown>, path: string, method: string, part: OperationPart): string {
  return printType(findProperty(findOperation(paths, path, method).type, part).type);
}

describe("Parameters", () => {
  const paths = {
    "/teams/{id}/": {
      parameters: [
        {name: "id", in: "path", required: true, schema: {type: "integer"}},
        {name: "expand", in: "query", schema: {type: "boolean"}},
      ],
      get: {
        parameters: [
          {name: "expand", in: "query", required: true, schema: {type: "string"}},
          {name: "fields", in: "query", schema: {type: "array", items: {type: "string"}}},
          {name: "X-Request-ID", in: "header", schema: {type: "string"}},
        ],
        responses: {200: TEAM_RESPONSE},
      },
      delete: {responses: {204: {description: ""}}},
    },
  };

  it("Verify path parameters are required", () => {
    assert.equal(renderPart(paths, "/teams/{id}/", "get", "path"), "{\n  id: number;\n}");
  });

  it("Verify operation parameters override path item parameters with the same name and location", () => {
    assert.equal(renderPart(paths, "/teams/{id}/", "get", "query"), "{\n  expand: string;\n  fields?: string[];\n}");
  });

  it("Verify path item parameters apply to operations that do not override them", () => {
    assert.equal(renderPart(paths, "/teams/{id}/", "delete", "query"), "{\n  expand?: boolean;\n}");
  });

  it("Verify operations without parameters in a location use never", () => {
    const simple = {"/teams/": {get: {responses: {200: TEAM_RESPONSE}}}};
    assert.equal(renderPart(simple, "/teams/", "get", "path"), "never");
    assert.equal(renderPart(simple, "/teams/", "get", "query"), "never");
  });

  it("Verify parameter references are resolved", () => {
    const document = buildDocument({
      paths: {"/teams/": {get: {parameters: [{$ref: "#/components/parameters/Limit"}], responses: {}}}},
      components: {parameters: {Limit: {name: "_limit", in: "query", schema: {type: "integer"}}}},
    });

    const endpoints = buildEndpoints(createContext(document));
    const query = findProperty(findProperty(findProperty(endpoints, "/teams/").type, "get").type, "query");
    assert.equal(printType(query.type), "{\n  _limit?: number;\n}");
  });

  it("Verify parameters described by content use the media type schema", () => {
    const withContent = {
      "/search/": {
        get: {
          parameters: [{name: "filter", in: "query", content: {"application/json": {schema: {type: "object"}}}}],
          responses: {},
        },
      },
    };

    assert.equal(renderPart(withContent, "/search/", "get", "query"), "{\n  filter?: { [key: string]: unknown };\n}");
  });
});

describe("RequestBodies", () => {
  it("Verify the JSON schema is used when a body offers several media types", () => {
    const paths = {
      "/teams/": {
        post: {
          requestBody: {
            content: {
              "multipart/form-data": {schema: {type: "object"}},
              "application/json": {schema: {$ref: "#/components/schemas/Team"}},
            },
          },
          responses: {201: TEAM_RESPONSE},
        },
      },
    };

    assert.equal(renderPart(paths, "/teams/", "post", "body"), "Team");
  });

  it("Verify JSON media types with parameters or suffixes are recognized", () => {
    const paths = {
      "/teams/": {
        post: {
          requestBody: {content: {"application/merge-patch+json; charset=utf-8": {schema: {type: "string"}}}},
          responses: {},
        },
      },
    };

    assert.equal(renderPart(paths, "/teams/", "post", "body"), "string");
  });

  it("Verify bodies without JSON content use never", () => {
    const paths = {
      "/uploads/": {
        post: {requestBody: {content: {"multipart/form-data": {schema: {type: "object"}}}}, responses: {}},
      },
    };

    assert.equal(renderPart(paths, "/uploads/", "post", "body"), "never");
  });
});

describe("Responses", () => {
  const paths = {
    "/teams/": {
      get: {responses: {200: TEAM_RESPONSE}},
      post: {
        responses: {
          default: {description: "Unexpected error.", content: {"application/json": {schema: {type: "string"}}}},
          400: {description: "", content: {"application/json": {schema: {type: "object"}}}},
          "2XX": {description: "", content: {"application/json": {schema: {type: "boolean"}}}},
          201: TEAM_RESPONSE,
        },
      },
      delete: {responses: {204: {description: "No response body"}}},
      put: {responses: {default: {description: "", content: {"application/json": {schema: {type: "string"}}}}}},
    },
    "/version/": {
      get: {responses: {200: {description: "", content: {"text/plain": {schema: {type: "string"}}}}}},
    },
  };

  it("Verify responses are keyed by status in sorted order", () => {
    const responses = renderPart(paths, "/teams/", "post", "responses");
    const keys = [...responses.matchAll(/^ {2}(\S+):/gm)].map((match) => match[1]);
    assert.deepEqual(keys, ["201", '"2XX"', "400", "default"]);
  });

  it("Verify the response combines every successful status", () => {
    assert.equal(renderPart(paths, "/teams/", "post", "response"), "Team | boolean");
  });

  it("Verify the default response is used when there are no successful statuses", () => {
    assert.equal(renderPart(paths, "/teams/", "put", "response"), "string");
  });

  it("Verify responses without content have a void body", () => {
    assert.equal(renderPart(paths, "/teams/", "delete", "response"), "void");
  });

  it("Verify responses with only non-JSON content have an unknown body", () => {
    assert.equal(renderPart(paths, "/version/", "get", "response"), "unknown");
  });

  it("Verify response references are resolved", () => {
    const document = buildDocument({
      paths: {"/teams/": {get: {responses: {404: {$ref: "#/components/responses/NotFound"}}}}},
      components: {responses: {NotFound: {description: "Not found.", content: {"application/json": {schema: {type: "string"}}}}}},
    });

    const endpoints = buildEndpoints(createContext(document));
    const responses = findProperty(findProperty(findProperty(endpoints, "/teams/").type, "get").type, "responses");
    assert.equal(printType(responses.type), "{\n  /** Not found. */\n  404: string;\n}");
  });
});

describe("PathsAndOperations", () => {
  it("Verify paths are sorted and methods follow the specification order", () => {
    const paths = {
      "/b/": {patch: {responses: {}}, get: {responses: {}}},
      "/a/": {delete: {responses: {}}, post: {responses: {}}},
    };

    const endpoints = buildEndpoints(createContext(buildDocument({paths})));
    assert.deepEqual(propertyNames(endpoints), ["/a/", "/b/"]);
    assert.deepEqual(propertyNames(findProperty(endpoints, "/b/").type), ["get", "patch"]);
  });

  it("Verify operation documentation includes the summary, description, and deprecation", () => {
    const paths = {"/teams/": {get: {summary: "List teams.", description: "Returns teams.", deprecated: true, responses: {}}}};
    assert.deepEqual(findOperation(paths, "/teams/", "get").docs, ["List teams.", "", "Returns teams.", "", "@deprecated"]);
  });

  it("Verify path item references are rejected", () => {
    const document = buildDocument({paths: {"/teams/": {$ref: "#/components/pathItems/Teams"}}});
    assert.throws(() => buildEndpoints(createContext(document)), /Path item references are not supported/);
  });
});
