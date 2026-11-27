// Démarre le VRAI bot (index.js) d'un profil avec un Discord simulé et un faux site
// local, lui envoie des commandes à préfixe et rend ce qu'il a répondu.
//   node scripts/prefix-e2e.mjs fdpdlavoc ";pv" "=pv" ";aide"
// Utilisé par prefix-e2e.test.js : chaque bot doit répondre à ses propres commandes.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GUILD = "900000000000000100";
const TOKENS = { guard: "PND_GUARD_TOKEN", fdpdlavoc: "PND_FDPDLAVOC_TOKEN", suckme: "PND_SUCKME_TOKEN", fisc: "PND_FISC_TOKEN", investplus: "PND_INVESTPLUS_TOKEN" };
const SETTINGS = {
  logs: { channelId: null }, sysPlus: { roleId: null, whitelistRoleId: null }, adminPlus: { roleId: null }, voiceAccess: null,
  prefixCommands: [], keywords: [], filter: { enabled: false, words: [] }, spam: { enabled: false }, welcome: { enabled: false },
  ai: { enabled: false, memoryEnabled: false, instructions: "" }, guildGuard: { enabled: false }, moderation: {}, verification: { enabled: false },
  tickets: { enabled: false }, tempVoice: { enabled: false }, automation: { autoRoleIds: [] }, liveAlerts: { enabled: false, creators: [] },
};

/** Lance le bot `profile`, envoie `commands` et rend { commande: [réponses] }. */
export async function runBotCommands(profile, commands, { settings = SETTINGS, timeoutMs = 60_000 } = {}) {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(req.method === "GET" ? JSON.stringify({ guilds: { [GUILD]: settings } }) : "{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "fwu-e2e-"));
  const env = { ...process.env, PND_BOT_PROFILE: profile === "fwu" ? "" : profile, DISCORD_TOKEN: "fwu-token", [TOKENS[profile] ?? "UNUSED_TOKEN"]: "other-token",
    SITE_URL: `http://127.0.0.1:${server.address().port}`, BOT_SYNC_SECRET: "e2e", HER_DB_PATH: join(dir, "db.sqlite"), PND_DATA_DIR: dir,
    PND_BOTS_CONFIG: join(dir, "absent-bots.json"), V4_ALLOWED_GUILD_IDS: GUILD, PND_OWNER_DISCORD_ID: "900000000000000001", E2E_GUILD: GUILD,
    E2E_COMMANDS: JSON.stringify(commands), SHARED_DATABASE_URL: "", NODE_TEST_CONTEXT: "" };
  for (const key of Object.keys(TOKENS)) if (key !== profile) delete env[TOKENS[key]];
  const preload = fileURLToPath(new URL("./prefix-e2e-preload.mjs", import.meta.url));
  const child = spawn(process.execPath, ["--no-warnings", "--import", preload, "index.js"], { cwd: fileURLToPath(new URL("..", import.meta.url)), env });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  const killer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const code = await new Promise((resolve) => child.on("exit", resolve));
  clearTimeout(killer);
  server.close();
  rmSync(dir, { recursive: true, force: true });
  const line = stdout.split("\n").find((l) => l.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`${profile} : pas de résultat (code ${code})\n${stdout.slice(-2000)}\n${stderr.slice(-2000)}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [profile, ...commands] = process.argv.slice(2);
  console.log(JSON.stringify(await runBotCommands(profile, commands), null, 1));
}
