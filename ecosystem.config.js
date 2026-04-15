module.exports = {
  apps: [
    {
      name: "unifi-portal",
      script: "node_modules/.bin/next",
      args: "start -p 80",
      cwd: __dirname,
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
