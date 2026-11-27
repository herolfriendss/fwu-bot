const path = require("node:path");
const root = __dirname;

module.exports = {
  apps: [
    {
      name: "her-v5-web",
      cwd: root,
      script: ".output/server/index.mjs",
      node_args: "--env-file=.env",
      env: {
        NODE_ENV: "production",
        NITRO_HOST: "127.0.0.1",
        NITRO_PORT: "3000",
      },
      max_memory_restart: "600M",
      autorestart: true,
      restart_delay: 5000,
      min_uptime: "15s",
      max_restarts: 10,
      time: true,
    },
    {
      name: "her-v5-bot",
      cwd: path.join(root, "bot"),
      script: "index.js",
      node_args: "--env-file=.env",
      env: {
        NODE_ENV: "production",
        // This process is always the main bot. Forced here because a PND_BOT_PROFILE left in the shell or in
        // bot/.env (node --env-file never overrides an existing variable, PM2's env wins) made it a second SUCK ME.
        PND_BOT_PROFILE: "fwu",
      },
      max_memory_restart: "600M",
      autorestart: true,
      restart_delay: 5000,
      min_uptime: "15s",
      max_restarts: 10,
      // 78 = gave up after repeated Discord connection failures (bot/gateway-watchdog.js).
      stop_exit_codes: [78],
      time: true,
    },
  ],
};
