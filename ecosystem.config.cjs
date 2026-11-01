const path = require("node:path");
const root = __dirname;

module.exports = {
  apps: [
    {
      name: "her-v3-web",
      cwd: root,
      script: ".output/server/index.mjs",
      node_args: "--env-file=.env",
      env: { NODE_ENV: "production", NITRO_HOST: "127.0.0.1", NITRO_PORT: "3000" },
      max_memory_restart: "450M",
      autorestart: true,
      time: true,
    },
    {
      name: "her-v3-bot",
      cwd: path.join(root, "bot"),
      script: "index.js",
      node_args: "--env-file=.env",
      env: { NODE_ENV: "production" },
      max_memory_restart: "350M",
      autorestart: true,
      time: true,
    },
  ],
};
