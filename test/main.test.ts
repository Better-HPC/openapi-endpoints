/** Function tests for the `openapi-endpoints` command line interface. */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, it } from "node:test";

import { main } from "../src/main.ts";
import { captureStreams, fixturePath, readFixture, withTemporaryDirectory } from "./support.ts";

/** Path of the example OpenAPI document. */
const EXAMPLE_SCHEMA = fixturePath("example.yml");

/** Generated module expected for the example OpenAPI document. */
const EXAMPLE_OUTPUT = readFixture("example.ts");

describe("OutputModes", () => {
  it("Verify the generated module is written to standard output without --output", async () => {
    const streams = captureStreams();
    assert.equal(await main([EXAMPLE_SCHEMA], streams), 0);
    assert.equal(streams.output(), EXAMPLE_OUTPUT);
    assert.equal(streams.errors(), "");
  });

  it("Verify --output writes the module and creates missing directories", async () => {
    await withTemporaryDirectory(async (directory) => {
      const output = join(directory, "nested", "api.ts");
      const streams = captureStreams();

      assert.equal(await main([EXAMPLE_SCHEMA, "--output", output], streams), 0);
      assert.equal(readFileSync(output, "utf8"), EXAMPLE_OUTPUT);
      assert.equal(streams.output(), `Wrote ${output}\n`);
    });
  });

  it("Verify the header names the schema file rather than its full path", async () => {
    const streams = captureStreams();
    await main([EXAMPLE_SCHEMA], streams);
    assert.match(streams.output(), /from `example.yml`/);
  });
});

describe("CheckMode", () => {
  it("Verify --check succeeds when the output file is up to date", async () => {
    await withTemporaryDirectory(async (directory) => {
      const output = join(directory, "api.ts");
      writeFileSync(output, EXAMPLE_OUTPUT, "utf8");

      const streams = captureStreams();
      assert.equal(await main([EXAMPLE_SCHEMA, "--output", output, "--check"], streams), 0);
      assert.equal(streams.output(), `${output} is up to date\n`);
    });
  });

  it("Verify --check fails without modifying an out of date output file", async () => {
    await withTemporaryDirectory(async (directory) => {
      const output = join(directory, "api.ts");
      writeFileSync(output, "// stale\n", "utf8");

      const streams = captureStreams();
      assert.equal(await main([EXAMPLE_SCHEMA, "-o", output, "--check"], streams), 1);
      assert.match(streams.errors(), /is out of date/);
      assert.equal(readFileSync(output, "utf8"), "// stale\n", "The output file should not be modified");
    });
  });

  it("Verify --check fails when the output file does not exist", async () => {
    await withTemporaryDirectory(async (directory) => {
      const streams = captureStreams();
      assert.equal(await main([EXAMPLE_SCHEMA, "-o", join(directory, "api.ts"), "--check"], streams), 1);
      assert.match(streams.errors(), /does not exist/);
    });
  });
});

describe("RemoteSchemas", () => {
  it("Verify a schema can be downloaded from a URL", async () => {
    const server = createServer((_request, response) => response.end(readFixture("example.yml")));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const {port} = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${port}/schema/`;
      const streams = captureStreams();

      assert.equal(await main([url], streams), 0);
      assert.match(streams.output(), new RegExp(`from \`${url}\``), "The header should name the URL");
      assert.match(streams.output(), /export interface Endpoints/);

    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("Verify failed downloads are reported", async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const {port} = server.address() as AddressInfo;
      const streams = captureStreams();

      assert.equal(await main([`http://127.0.0.1:${port}/missing/`], streams), 1);
      assert.match(streams.errors(), /HTTP 404/);

    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("Failures", () => {
  it("Verify missing schema files are reported", async () => {
    const streams = captureStreams();
    assert.equal(await main(["does-not-exist.yml"], streams), 1);
    assert.match(streams.errors(), /^error: .*does-not-exist\.yml/);
  });

  it("Verify invalid documents are reported with their location", async () => {
    await withTemporaryDirectory(async (directory) => {
      const schema = join(directory, "schema.yml");
      writeFileSync(schema, "openapi: 3.0.3\ncomponents:\n  schemas:\n    Team:\n      not: {}\n", "utf8");

      const streams = captureStreams();
      assert.equal(await main([schema], streams), 1);
      assert.equal(streams.errors(), 'error: Unsupported schema keyword "not" at #/components/schemas/Team/not\n');
    });
  });
});

describe("UsageErrors", () => {
  it("Verify a missing schema argument is a usage error", async () => {
    const streams = captureStreams();
    assert.equal(await main([], streams), 2);
    assert.match(streams.errors(), /Missing the <schema> argument/);
  });

  it("Verify extra arguments are a usage error", async () => {
    const streams = captureStreams();
    assert.equal(await main(["one.yml", "two.yml"], streams), 2);
    assert.match(streams.errors(), /Expected a single <schema> argument/);
  });

  it("Verify --check without --output is a usage error", async () => {
    const streams = captureStreams();
    assert.equal(await main([EXAMPLE_SCHEMA, "--check"], streams), 2);
    assert.match(streams.errors(), /requires --output/);
  });

  it("Verify unknown options are a usage error", async () => {
    const streams = captureStreams();
    assert.equal(await main([EXAMPLE_SCHEMA, "--watch"], streams), 2);
    assert.match(streams.errors(), /Run "openapi-endpoints --help" for usage/);
  });
});

describe("InformationalOptions", () => {
  it("Verify --help prints the usage text", async () => {
    const streams = captureStreams();
    assert.equal(await main(["--help"], streams), 0);
    assert.match(streams.output(), /^Usage: openapi-endpoints <schema> \[options\]/);
  });

  it("Verify --version prints the package version", async () => {
    const metadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {version: string};
    const streams = captureStreams();

    assert.equal(await main(["-v"], streams), 0);
    assert.equal(streams.output(), `${metadata.version}\n`);
  });
});
