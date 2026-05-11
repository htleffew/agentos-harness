/**
 * ecosystem.config.js — PM2 process ecosystem configuration.
 *
 * Used when PM2 is available. On machines without PM2, the Python
 * process manager (harness dashboard start) handles spawning instead.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 stop ecosystem.config.js
 *   pm2 logs
 */

const path = require("path");

// Read workspace from env, fall back to parent of dashboard dir
const workspace = process.env.AGENTOS_WORKSPACE || path.resolve(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "agentos-dashboard-web",
      script: "node_modules/.bin/next",
      args: "dev --port 8768",
      cwd: __dirname,
      env: {
        NODE_ENV: "development",
        AGENTOS_WORKSPACE: workspace,
        CLAUDE_PROJECT_DIR: workspace,
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      error_file: path.join(workspace, ".harness/state/dashboard-web-error.log"),
      out_file: path.join(workspace, ".harness/state/dashboard-web.log"),
    },
    {
      name: "agentos-dashboard-daemon",
      script: "scripts/daemon/index.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "development",
        AGENTOS_WORKSPACE: workspace,
        CLAUDE_PROJECT_DIR: workspace,
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      error_file: path.join(workspace, ".harness/state/dashboard-daemon-error.log"),
      out_file: path.join(workspace, ".harness/state/dashboard-daemon.log"),
    },
  ],
};
