// pm2 process file for the STARCUT authority (recommended VPS setup, no Docker).
// Production and staging run side by side on one VPS, on separate ports and
// separate data directories. Secrets live in env files ON THE VPS only
// (/etc/starcut/<env>.env) — never in the repo or the client bundle.
//
//   pm2 startOrReload ecosystem.config.cjs --only starcut-production
//   pm2 startOrReload ecosystem.config.cjs --only starcut-staging
const common = {
  script: "dist-server/index.mjs",
  cwd: __dirname,
  instances: 1, // rooms live in memory: one process per environment
  autorestart: true,
  max_memory_restart: "700M",
  kill_timeout: 5000,
  time: true
};

module.exports = {
  apps: [
    {
      ...common,
      name: "starcut-production",
      node_args: "--env-file=/etc/starcut/production.env",
      env: { NODE_ENV: "production", PORT: 9208, RTC_PORT_MIN: 20000, RTC_PORT_MAX: 20010, STARCUT_DATA: "/var/lib/starcut/production" }
    },
    {
      ...common,
      name: "starcut-staging",
      node_args: "--env-file=/etc/starcut/staging.env",
      env: { NODE_ENV: "production", PORT: 9308, RTC_PORT_MIN: 20100, RTC_PORT_MAX: 20110, STARCUT_DATA: "/var/lib/starcut/staging" }
    }
  ]
};
