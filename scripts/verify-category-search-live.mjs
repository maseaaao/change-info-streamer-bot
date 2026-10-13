import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { StreamerbotClient } from "@streamerbot/client";

// Read-only search acceptance checks: never calls update/apply/preset commands.
let resolveConnection;
let rejectConnection;
const connected = new Promise((resolve, reject) => { resolveConnection = resolve; rejectConnection = reject; });
const client = new StreamerbotClient({ host: "127.0.0.1", port: 8080, endpoint: "/", immediate: false,
  autoReconnect: false, retries: 0, logLevel: "none", onConnect: resolveConnection, onError: rejectConnection });
const pending = new Map();
await client.on("Custom.CodeEvent", payload => {
  const event = payload?.data;
  if (event?.eventName !== "stream_info_api_response") return;
  pending.get(event.args?.requestId)?.(event.args);
});
let action;
async function search(query, cursor) {
  const requestId = `search-check-${randomUUID()}`;
  const start = performance.now();
  let timer;
  const reply = new Promise((resolve, reject) => {
    timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Search timed out: ${query}`)); }, 14_000);
    pending.set(requestId, response => { clearTimeout(timer); pending.delete(requestId); resolve(response); });
  });
  try {
    await client.doAction({ id: action.id }, { command: "searchTwitchCategories", requestId,
      payloadJson: JSON.stringify({ query, ...(cursor ? { cursor } : {}) }) });
    const response = await reply;
    assert.equal(response.ok, true, `${query}: ${response.error?.message ?? "unsuccessful reply"}`);
    assert.ok(Array.isArray(response.data?.results), `${query}: malformed results`);
    return { ...response.data, elapsedMs: Math.round(performance.now() - start) };
  } finally { clearTimeout(timer); pending.delete(requestId); }
}
const normalized = name => name.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
try {
  const connectionTimer = setTimeout(() => rejectConnection(new Error("Connection timeout")), 10_000);
  try { await Promise.all([client.connect(), connected]); } finally { clearTimeout(connectionTimer); }
  action = (await client.getActions()).actions.find(item => item.name === "STREAM INFO | API" && item.enabled);
  assert.ok(action, "Search Action missing or disabled");
  const report = [];
  for (const query of ["Aniimo", "ani", "Counter Strike", "Final Fantasy", "Pokemon", "CS2", "2048"]) {
    const result = await search(query);
    const first = result.results[0];
    assert.ok(first, `${query}: no candidates`);
    const ids = result.results.map(item => item.id);
    assert.equal(new Set(ids).size, ids.length, `${query}: duplicate IDs`);
    if (query === "Aniimo") assert.equal(first.name.toLowerCase(), "aniimo");
    if (query === "ani" || query === "Final Fantasy") assert.ok(result.results.length > 1, `${query}: exact lookup suppressed autocomplete`);
    if (query === "Counter Strike") assert.equal(normalized(first.name), "counter strike", "Punctuation-equivalent title must precede long substring");
    if (query === "Pokemon") assert.ok(normalized(first.name).startsWith("pokemon"), "Diacritic-equivalent titles must precede unrelated lookup aliases");
    if (query === "CS2") assert.ok(result.results.some(item => normalized(item.name) === "counter strike"), "Common abbreviation must include its configured canonical title");
    report.push({ query, count: result.results.length, first: result.results.slice(0, 3).map(item => ({ id: item.id, name: item.name })),
      hasMore: result.hasMore === true, partial: result.partial === true, elapsedMs: result.elapsedMs });
    if (query === "Pokemon" && result.hasMore && result.cursor) {
      const next = await search(query, result.cursor);
      assert.ok(next.results.length, "Pagination returned no next candidates");
      assert.notEqual(next.cursor, result.cursor, "Pagination did not advance");
      report.push({ query, page: 2, count: next.results.length, hasMore: next.hasMore === true, elapsedMs: next.elapsedMs });
    }
  }
  const repeated = await search("Aniimo");
  assert.equal(repeated.results[0]?.name.toLowerCase(), "aniimo");
  console.log(JSON.stringify({ ok: true, actionId: action.id, queries: report, repeatMs: repeated.elapsedMs }, null, 2));
} finally {
  for (const resolve of pending.values()) resolve({ ok: false, error: { message: "Disconnected" }, data: null });
  pending.clear();
  await client.disconnect().catch(() => {});
}
