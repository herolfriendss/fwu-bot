import test from "node:test";
import assert from "node:assert/strict";
import { describeIntelligenceSyncFailure, readSyncResponse } from "./sysplus-sync.js";

test("SYS+ sync response reader handles JSON and non-JSON responses", async () => {
  assert.deepEqual(await readSyncResponse(new Response('{"ok":true}', { status: 200 })), { ok: true });
  assert.deepEqual(await readSyncResponse(new Response("not-json", { status: 502 })), { error: "not-json" });
  assert.equal(await readSyncResponse(new Response(null, { status: 204 })), null);
});

test("SYS+ intelligence sync errors explain likely deployment and credential failures", () => {
  assert.match(describeIntelligenceSyncFailure(401), /BOT_SYNC_SECRET/);
  assert.match(describeIntelligenceSyncFailure(404), /redéployé/);
  assert.match(describeIntelligenceSyncFailure(400), /identifiants Discord/);
  assert.match(describeIntelligenceSyncFailure(503, { error: "settings_persistence_failed" }), /Supabase/);
  assert.match(describeIntelligenceSyncFailure(502), /HTTP 502/);
  assert.match(describeIntelligenceSyncFailure(0), /SITE_URL/);
});

test("SYS+ intelligence sync identifies missing settings table and Supabase permission errors", () => {
  assert.match(describeIntelligenceSyncFailure(503, { error: "bot_settings_table_missing" }), /202611200001_bot_settings_sync\.sql/);
  assert.match(describeIntelligenceSyncFailure(503, { error: "bot_settings_permission_denied" }), /service_role/);
  assert.match(describeIntelligenceSyncFailure(503, { error: "supabase_not_configured" }), /SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/);
});
