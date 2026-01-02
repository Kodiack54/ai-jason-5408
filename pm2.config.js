module.exports = {
  apps: [{
    name: 'jason-5408',
    script: 'src/run.js',
    args: 'extract --scheduled',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production'
    },
    // Run every 30 minutes via cron
    cron_restart: '*/30 * * * *',
    // Log settings
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true
  }]
};
