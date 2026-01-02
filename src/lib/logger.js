/**
 * Jason's Logger
 * Rotating file logging with color console output
 */

const fs = require('fs');
const path = require('path');

const COLORS = {
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  debug: '\x1b[90m',
  success: '\x1b[32m',
  reset: '\x1b[0m'
};

const LOG_DIR = path.join(__dirname, '../../logs');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 5;

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

class Logger {
  constructor(prefix = 'Jason') {
    this.prefix = prefix;
    this.logFile = path.join(LOG_DIR, 'jason.log');
  }

  _formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.prefix}] ${message}${metaStr}`;
  }

  _writeToFile(formatted) {
    try {
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        if (stats.size > MAX_LOG_SIZE) {
          this._rotateLog();
        }
      }
      fs.appendFileSync(this.logFile, formatted + '\n');
    } catch (err) {
      // Silent fail for file logging
    }
  }

  _rotateLog() {
    try {
      for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
        const oldFile = `${this.logFile}.${i}`;
        const newFile = `${this.logFile}.${i + 1}`;
        if (fs.existsSync(oldFile)) {
          if (i === MAX_LOG_FILES - 1) {
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }
      fs.renameSync(this.logFile, `${this.logFile}.1`);
    } catch (err) {
      // Silent fail
    }
  }

  _log(level, message, meta = {}) {
    const formatted = this._formatMessage(level, message, meta);
    const color = COLORS[level] || COLORS.reset;
    console.log(`${color}${formatted}${COLORS.reset}`);
    this._writeToFile(formatted);
  }

  info(message, meta) { this._log('info', message, meta); }
  warn(message, meta) { this._log('warn', message, meta); }
  error(message, meta) { this._log('error', message, meta); }
  success(message, meta) { this._log('success', message, meta); }
  debug(message, meta) {
    if (process.env.DEBUG) {
      this._log('debug', message, meta);
    }
  }
}

module.exports = { Logger };
