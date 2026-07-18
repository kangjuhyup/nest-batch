#!/usr/bin/env node
import { runCli } from "./index.js";

const result = await runCli(process.argv.slice(2));

if (result.output.length > 0) {
  console.log(result.output);
}

process.exitCode = result.exitCode;
