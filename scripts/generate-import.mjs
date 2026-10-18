import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const project = resolve(import.meta.dirname, "..");
const packageMetadata = JSON.parse(readFileSync(resolve(project, "package.json"), "utf8"));
// Collect every helper's imports before all classes; Streamer.bot compiles one
// combined source, not separate compilation units. Keep helper order explicit.
const sources = [
  "action.cs", "state-cache-policy.cs",
  "category-search-policy.cs", "category-search-service.cs", "category-search-transport.cs",
].map(name => readFileSync(resolve(project, "streamerbot", name), "utf8"));
const usings = [...new Set(sources.flatMap(source => source.match(/^using [^;]+;/gm) ?? []))];
const bodies = sources.map(source => source.split(String.fromCharCode(10)).filter(line => !line.startsWith("using ")).join(String.fromCharCode(10)).trim());
const actionSource = `${usings.join("\n")}\n\n${bodies.join("\n\n")}\n`;
const EXPORTED_FROM = "1.0.7";
// Streamer.bot 1.0.7 rejects an import when minimumVersion equals its own
// version, so the compatibility floor must stay below the exporter version.
const MINIMUM_COMPATIBLE_VERSION = "1.0.6";

// This is the Streamer.bot 1.0.x export schema: SBAE + gzip + base64.  The
// shape was cross-checked against an official Streamer.bot import and the
// resulting action is compiled by an isolated real 1.0.7 instance in tests.
const action = {
  id: "9c4b1bc3-e5d8-458d-9171-69e74c89289a",
  queue: null,
  enabled: true,
  excludeFromHistory: false,
  name: "STREAM INFO | API",
  group: "STREAM INFO",
  alwaysRun: false,
  randomAction: false,
  concurrent: true,
  triggers: [],
  actions: [
    {
      name: "STREAM INFO API router",
      description: "Internal API for change-info-streamer-bot.html",
      references: [
        "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\mscorlib.dll",
        "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.dll",
        "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Core.dll",
        "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Net.Http.dll",
        ".\\Newtonsoft.Json.dll",
      ],
      byteCode: Buffer.from(actionSource, "utf8").toString("base64"),
      precompile: true,
      delayStart: false,
      saveResultToVariable: false,
      saveToVariable: null,
      id: "008b1b1d-569b-4534-bf65-cd51d54fa826",
      weight: 0.0,
      type: 99999,
      parentId: null,
      enabled: true,
      index: 0,
    },
  ],
  actionGroups: [],
  collapsedGroups: [],
};

const exported = {
  meta: {
    name: "STREAM INFO | API",
    author: "change-info-streamer-bot",
    version: packageMetadata.version,
    description: "Twitch API for the standalone Stream Info HTML.",
    autoRunAction: null,
    minimumVersion: MINIMUM_COMPATIBLE_VERSION,
  },
  data: {
    actions: [action],
    queues: [],
    commands: [],
    websocketServers: [],
    websocketClients: [],
    timers: [],
  },
  version: 10,
  exportedFrom: EXPORTED_FROM,
  minimumVersion: MINIMUM_COMPATIBLE_VERSION,
};

const importCode = Buffer.concat([Buffer.from("SBAE", "ascii"), gzipSync(Buffer.from(JSON.stringify(exported), "utf8"))]).toString("base64");
const importPath = resolve(project, "streamerbot-import.txt");
writeFileSync(importPath, `${importCode}\n`, "utf8");
console.log(`Generated native import string (${importCode.length} characters).`);
