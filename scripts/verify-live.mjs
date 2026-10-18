import { randomUUID } from "node:crypto";
import { StreamerbotClient } from "@streamerbot/client";

const actionName = "STREAM INFO | API";
const responseEvent = "stream_info_api_response";

let connectedResolve;
let connectedReject;
const connected = new Promise((resolve, reject) => {
  connectedResolve = resolve;
  connectedReject = reject;
});

const client = new StreamerbotClient({
  host: "127.0.0.1",
  port: 8080,
  endpoint: "/",
  immediate: false,
  autoReconnect: false,
  retries: 0,
  logLevel: "none",
  onConnect: connectedResolve,
  onError: connectedReject,
});

const pending = new Map();
await client.on("Custom.CodeEvent", (payload) => {
  const root = payload?.data;
  if (root?.eventName !== responseEvent || !root.args?.requestId) return;
  const resolve = pending.get(root.args.requestId);
  if (!resolve) return;
  pending.delete(root.args.requestId);
  resolve(root.args);
});

function waitForResponse(requestId, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Timed out waiting for ${requestId}`));
    }, timeoutMs);
    pending.set(requestId, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

try {
  await client.connect();
  await Promise.race([
    connected,
    new Promise((_, reject) => setTimeout(() => reject(new Error("WebSocket connection timeout")), 10_000)),
  ]);

  const actions = await client.getActions();
  const action = actions.actions.find((candidate) => candidate.name === actionName);
  if (!action?.enabled) throw new Error(`${actionName} is missing or disabled`);

  const requestId = `codex-live-${randomUUID()}`;
  const reply = waitForResponse(requestId);
  await client.doAction({ id: action.id }, { command: "getState", requestId, payloadJson: "{}" });
  const response = await reply;

  if (response.ok !== true || response.apiVersion !== 4 || !response.data) {
    throw new Error(`Unexpected Action response: ${JSON.stringify(response)}`);
  }

  console.log(JSON.stringify({
    websocketReady: client.ready,
    actionId: action.id,
    actionEnabled: action.enabled,
    apiVersion: response.apiVersion,
    responseOk: response.ok,
    twitchConnected: response.data.twitch?.connected === true,
    twitchLive: response.data.twitch?.live === true,
    templatesPresent: typeof response.data.templates?.twitchTemplate === "string",
  }, null, 2));
} finally {
  await client.disconnect().catch(() => {});
}
