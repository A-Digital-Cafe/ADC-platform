#!/usr/bin/env node
import { collectClients } from "./security-matrix/collect-clients.mjs";
import { collectEndpoints } from "./security-matrix/collect-endpoints.mjs";
import { formatMatrix } from "./security-matrix/format-matrix.mjs";
import { rootPath, writeText } from "./security-matrix/fs.mjs";

const outputPath = rootPath("private/audits/backend-security-matrix.md");
const endpoints = collectEndpoints();
const clients = collectClients();

writeText(outputPath, formatMatrix(endpoints, clients));
console.log(`Generated ${outputPath} (${endpoints.length} endpoints, ${clients.calls.length} client calls)`);
