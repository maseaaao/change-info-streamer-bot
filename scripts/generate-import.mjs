import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const project = resolve(import.meta.dirname, "..");
const packageMetadata = JSON.parse(readFileSync(resolve(project, "package.json"), "utf8"));
const cacheSource = readFileSync(resolve(project, "streamerbot/state-cache-policy.cs"), "utf8");
const cacheBody = cacheSource.replace(/^using System;\r?\n\r?\n/, "");
const policySource = readFileSync(resolve(project, "streamerbot/automatic-youtube-policy.cs"), "utf8");
const policyBody = policySource.replace(/^using System;\r?\n\r?\n/, "");
const actionSource = `${readFileSync(resolve(project, "streamerbot/action.cs"), "utf8")}\n${cacheBody}\n${policyBody}`;
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
  triggers: [
    {
      // YouTube -> Broadcast -> Started. The numeric trigger type is the
      // stable Streamer.bot 1.0.x export representation.
      id: "5f9a1464-3571-4a20-b5ba-0c350db9c15a",
      type: 4001,
      enabled: true,
      exclusions: [],
    },
  ],
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
    description: "One Action API for the standalone Stream Info HTML with automatic YouTube metadata on broadcast start.",
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
