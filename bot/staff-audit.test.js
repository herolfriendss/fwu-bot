import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-staff-audit-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const { getStaffMemberHistory } = await import("./staff-audit.js");

after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

test("staff member history merges moderation, audit and voice sessions by date", () => {
  db.prepare("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,created_at) VALUES('123456','777777','654321','ban','Spam',3000)").run();
  db.prepare("INSERT INTO audit_events(guild_id,category,action,actor_id,target_id,channel_id,details_json,occurred_at,source) VALUES('123456','voice','déplacement','654321','777777','222222','{}',4000,'gateway')").run();
  db.prepare("INSERT INTO voice_sessions(guild_id,user_id,channel_id,joined_at,left_at,duration_ms,start_precision,end_precision,end_reason) VALUES('123456','777777','222222',1000,2000,1000,'exact','exact','leave')").run();
  db.prepare("INSERT INTO recruitment_applications(application_id,guild_id,applicant_id,answers_json,status,reviewer_id,decision_note,submitted_at,updated_at,expires_at) VALUES('app-1','123456','777777','[]','accepted','654321','Retenu',500,5000,999999)").run();
  db.prepare("INSERT INTO recruitment_interviews(interview_id,guild_id,application_id,interviewer_id,starts_at,status,score,notes,created_by,created_at,updated_at) VALUES('interview-1','123456','app-1','654321',4500,'completed',5,'Excellent', '654321',1000,5000)").run();
  db.prepare("INSERT INTO sysplus_incidents(incident_id,guild_id,title,summary,severity,status,created_by,assigned_to,resolved_by,resolution,created_at,updated_at,resolved_at) VALUES('incident-1','123456','Raid','Alerte','high','resolved','654321','777777','654321','Compte protégé',1000,5500,5500)").run();
  db.prepare("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,created_at) VALUES('999999','777777','654321','ban','Other guild',5000)").run();
  const history = getStaffMemberHistory("123456", "777777", 10);
  assert.deepEqual(history.map((entry) => entry.type), ["incident", "recruitment", "recruitment_interview", "voice", "moderation", "voice_session"]);
  assert.equal(history[0].actorId, "654321");
  assert.equal(history[1].reason, "Retenu");
  assert.equal(history[2].reason, "Excellent");
  assert.equal(history[3].actorId, "654321");
  assert.equal(history[4].reason, "Spam");
  assert.equal(history[5].durationMs, 1000);
  assert.equal(getStaffMemberHistory("123456", "777777", 1).length, 1);
  assert.equal(getStaffMemberHistory("123456", "888888").length, 0);
});
