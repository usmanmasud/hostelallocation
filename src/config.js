import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const isProduction = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

function integer(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveDatabasePath(value) {
  if (value === ':memory:') return value;
  return value ? path.resolve(ROOT_DIR, value) : path.join(ROOT_DIR, 'data', 'hostel.db');
}

let temporarySecret;

/** Resolved on first use, so scripts that never start the web server need no secret. */
function sessionSecret() {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (isProduction) throw new Error('SESSION_SECRET must be set in production.');
  if (!temporarySecret) {
    if (!isTest) console.warn('[config] SESSION_SECRET not set; using a temporary secret (sessions reset on restart).');
    temporarySecret = randomBytes(32).toString('hex');
  }
  return temporarySecret;
}

export const config = Object.freeze({
  isProduction,
  isTest,
  port: integer(env.PORT, 3000),
  get sessionSecret() {
    return sessionSecret();
  },
  databasePath: resolveDatabasePath(env.DATABASE_PATH),
  timezone: env.APP_TIMEZONE || 'Africa/Lagos',
  escalationCheckMinutes: Math.max(1, integer(env.ESCALATION_CHECK_MINUTES, 15)),
  bootstrapAdmin: {
    email: env.BOOTSTRAP_ADMIN_EMAIL || 'admin@hostel.local',
    password: env.BOOTSTRAP_ADMIN_PASSWORD || '',
  },
  mail: {
    host: env.SMTP_HOST || '',
    port: integer(env.SMTP_PORT, 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Smart Hostel <no-reply@hostel.local>',
  },
});
