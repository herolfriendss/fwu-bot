module.exports = {
  apps: [
    {
      name: "her-agents",
      cwd: __dirname,
      script: "src/index.js",
      node_args: "--env-file=.env",
      env: { NODE_ENV: "production" },
      max_memory_restart: "300M",
      autorestart: true,
      time: true,
    },
  ],
};
