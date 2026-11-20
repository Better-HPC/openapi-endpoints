/** Unit tests for the `createModelNames` and `buildModelDeclarations` functions. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildModelDeclarations, createModelNames } from "../src/models.ts";
import { buildDocument, createContext } from "./support.ts";

describe("ModelNames", () => {
  it("Verify valid identifiers are used unchanged and sorted by schema name", () => {
    const names = createModelNames({UserSummary: {}, Team: {}, _Internal: {}}, new Set());
    assert.deepEqual([...names], [["Team", "Team"], ["UserSummary", "UserSummary"], ["_Internal", "_Internal"]]);
  });

  it("Verify other names are converted to PascalCase identifiers", () => {
    const names = createModelNames({"pet-status": {}, "api.v2.Error": {}, "3d model": {}}, new Set());
    assert.equal(names.get("pet-status"), "PetStatus");
    assert.equal(names.get("api.v2.Error"), "ApiV2Error");
    assert.equal(names.get("3d model"), "_3dModel");
  });

  it("Verify names that convert to the same identifier are rejected", () => {
    assert.throws(() => createModelNames({"pet-status": {}, PetStatus: {}}, new Set()), /both use the type name "PetStatus"/);
  });

  it("Verify reserved and generated names are rejected", () => {
    assert.throws(() => createModelNames({string: {}}, new Set()), /conflicts with a reserved type name/);
    assert.throws(() => createModelNames({Endpoints: {}}, new Set(["Endpoints"])), /conflicts with a reserved type name/);
  });

  it("Verify names without identifier characters are rejected", () => {
    assert.throws(() => createModelNames({"--": {}}, new Set()), /cannot be converted to a type name/);
  });
});

describe("ModelDeclarations", () => {
  it("Verify object schemas are declared as documented interfaces", () => {
    const schemas = {Team: {type: "object", description: "A team.", properties: {id: {type: "integer"}}, required: ["id"]}};
    const context = createContext(buildDocument({components: {schemas}}));
    assert.deepEqual(buildModelDeclarations(context, schemas), ["/** A team. */\nexport interface Team {\n  id: number;\n}"]);
  });

  it("Verify other schemas are declared as type aliases", () => {
    const schemas = {Role: {type: "string", enum: ["OW", "MB"]}, Teams: {type: "array", items: {$ref: "#/components/schemas/Role"}}};
    const context = createContext(buildDocument({components: {schemas}}));
    assert.deepEqual(buildModelDeclarations(context, schemas), [
      'export type Role = "OW" | "MB";',
      "export type Teams = Role[];",
    ]);
  });

  it("Verify recursive schemas refer to themselves by name", () => {
    const schemas = {Node: {type: "object", properties: {children: {type: "array", items: {$ref: "#/components/schemas/Node"}}}}};
    const context = createContext(buildDocument({components: {schemas}}));
    assert.deepEqual(buildModelDeclarations(context, schemas), ["export interface Node {\n  children?: Node[];\n}"]);
  });
});
