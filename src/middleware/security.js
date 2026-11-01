import { randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Synchronizer-token CSRF protection: every session gets a random token that each
 * state-changing request must send back as the `_csrf` form field or `X-CSRF-Token` header.
 */
export function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (SAFE_METHODS.has(req.method)) return next();

  const sent = String(req.body?._csrf ?? req.get('x-csrf-token') ?? '');
  const expected = req.session.csrfToken;
  const valid = sent.length === expected.length && timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!valid) return next(new HttpError(403, 'Your session has expired. Please go back, refresh the page and try again.'));
  next();
}

/** One-time messages carried across a redirect. */
export function flashMessages(req, res, next) {
  req.flash = (type, message) => {
    req.session.flash = [...(req.session.flash ?? []), { type, message }];
  };
  res.locals.flash = req.session.flash ?? [];
  delete req.session.flash;
  next();
}

/**
 * Limits failed sign-in attempts per IP address and email. In-memory, which suits the
 * single-process deployment this application targets.
 */
export function createLoginThrottle({ maxAttempts = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map();

  const keyFor = (req) => `${req.ip}|${String(req.body?.email ?? '').toLowerCase()}`;
  const prune = (now) => {
    for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);
  };

  return {
    isBlocked(req) {
      const now = Date.now();
      prune(now);
      const entry = attempts.get(keyFor(req));
      return entry && entry.count >= maxAttempts ? Math.ceil((entry.resetAt - now) / 60000) : 0;
    },
    recordFailure(req) {
      const key = keyFor(req);
      const entry = attempts.get(key) ?? { count: 0, resetAt: Date.now() + windowMs };
      entry.count += 1;
      attempts.set(key, entry);
    },
    reset(req) {
      attempts.delete(keyFor(req));
    },
  };
}
