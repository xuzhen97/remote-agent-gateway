/**
 * PM2 Ecosystem File — Remote Agent Gateway
 *
 * 用法:
 *   pm2 start ecosystem.config.cjs              # 启动全部（server + client）
 *   pm2 start ecosystem.config.cjs --only rag-server   # 仅 server
 *   pm2 start ecosystem.config.cjs --only rag-client   # 仅 client
 *   pm2 restart all                             # 重启全部
 *   pm2 stop all                                # 停止全部
 *   pm2 logs                                    # 查看日志
 *   pm2 monit                                   # 实时监控
 *   pm2 save                                    # 保存进程列表（开机自启）
 *   pm2 startup                                 # 设置开机自启
 */

const fs = require('fs');
const path = require('path');

// 自动检测部署布局：
// 1) 打平部署：ecosystem.config.cjs 与 *.bundle.cjs 同级
// 2) 源码运行：bundle 位于 ./dist/
const FLAT_BUNDLE_DIR = __dirname;
const DIST_FALLBACK_DIR = path.resolve(__dirname, 'dist');
const DIST_DIR = fs.existsSync(path.join(FLAT_BUNDLE_DIR, 'server.bundle.cjs'))
  && fs.existsSync(path.join(FLAT_BUNDLE_DIR, 'client.bundle.cjs'))
  ? FLAT_BUNDLE_DIR
  : DIST_FALLBACK_DIR;
const SERVER_SCRIPT = path.join(DIST_DIR, 'server.bundle.cjs');
const CLIENT_SCRIPT = path.join(DIST_DIR, 'client.bundle.cjs');

// 日志目录
const LOG_DIR = process.env.PM2_LOG_DIR || path.resolve(__dirname, 'logs');

module.exports = {
  apps: [
    // ── Server ──────────────────────────────────────────────────────
    {
      name: 'rag-server',
      script: SERVER_SCRIPT,
      cwd: path.resolve(__dirname),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',

      // 环境变量
      env: {
        NODE_ENV: 'production',
        RAG_SERVER_CONFIG: path.join(DIST_DIR, 'server.config.yaml'),
      },

      // 日志
      error_file: path.join(LOG_DIR, 'server-error.log'),
      out_file: path.join(LOG_DIR, 'server-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // 优雅重启
      kill_timeout: 10000,
      listen_timeout: 5000,
    },

    // ── Client ──────────────────────────────────────────────────────
    {
      name: 'rag-client',
      script: CLIENT_SCRIPT,
      cwd: path.resolve(__dirname),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',

      // 环境变量
      env: {
        NODE_ENV: 'production',
        RAG_CLIENT_CONFIG: path.join(DIST_DIR, 'client.config.yaml'),
      },

      // 日志
      error_file: path.join(LOG_DIR, 'client-error.log'),
      out_file: path.join(LOG_DIR, 'client-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // 优雅重启
      kill_timeout: 10000,
    },
  ],
};
