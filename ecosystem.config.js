module.exports = {
  apps: [{
    name: 'wesla-trial',
    script: 'backend/server.js',
    cwd: '/opt/wesla-trial',
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: 3000
    },
    max_memory_restart: '512M',
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s',
    error_file: '/var/log/wesla/error.log',
    out_file: '/var/log/wesla/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
