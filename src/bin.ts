#!/usr/bin/env node
/** Executable entry point for the `openapi-endpoints` command. */

import { main } from "./main.ts";

process.exitCode = main(process.argv.slice(2));
