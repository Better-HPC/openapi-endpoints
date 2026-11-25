#!/usr/bin/env node
/** The primary application entrypoint when executed from the command line. */

import { main } from "./main.ts";

void main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
