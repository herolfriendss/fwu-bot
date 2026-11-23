// FWU — les 4 bots spécialisés. À lancer EN PLUS de ecosystem.v5.config.cjs
// (her-v5-web et her-v5-bot = FWU restent inchangés).
//   pm2 start ecosystem.fwu-bots.config.cjs --only fwu-guard
// Chaque bot lit le même bot/.env (tokens PND_<BOT>_TOKEN) et la même base
// SQLite : un verrou de domaine garantit qu'un seul processus traite chaque domaine.
const path = require("node:path");
const root = __dirname;

const bot = (profile) => ({
  name: `fwu-${profile}`,
  cwd: path.join(root, "bot"),
  script: "index.js",
  node_args: "--env-file=.env",
  env: { NODE_ENV: "production", PND_BOT_PROFILE: profile },
  max_memory_restart: "140M",
  autorestart: true,
  restart_delay: 5000,
  min_uptime: "15s",
  max_restarts: 10,
  kill_timeout: 5000,
  time: true,
});

module.exports = {
  apps: ["guard", "fdpdlavoc", "suckme", "fisc"].map(bot),
};
