module.exports = {
  apps: [
    {
      name: "unifi-portal",
      script: "npm",
      args: "start",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
