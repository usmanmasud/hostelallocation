import { ROLES } from '../lib/constants.js';
import { forbidden } from '../lib/errors.js';
import * as notifications from '../repositories/notifications.js';
import * as students from '../repositories/students.js';
import * as users from '../repositories/users.js';

export const HOME_BY_ROLE = Object.freeze({
  [ROLES.STUDENT]: '/student',
  [ROLES.HOSTEL_ADMIN]: '/admin',
  [ROLES.SYSTEM_ADMIN]: '/system',
});

/**
 * Loads the signed-in user on every request. A deactivated or deleted account is signed
 * out immediately, so access changes take effect without waiting for the session to expire.
 */
export function loadCurrentUser(req, res, next) {
  const userId = req.session.userId;
  if (!userId) return next();
  const user = users.findById(userId);
  if (!user || !user.is_active) {
    return req.session.regenerate((error) => next(error));
  }
  req.user = user;
  if (user.role === ROLES.STUDENT) req.student = students.findByUserId(user.id);
  res.locals.currentUser = user;
  res.locals.unreadCount = notifications.unreadCount(user.id);
  next();
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  req.session.returnTo = req.method === 'GET' ? req.originalUrl : undefined;
  req.flash('info', 'Please sign in to continue.');
  res.redirect('/login');
}

export function requireRole(...roles) {
  return [
    requireAuth,
    (req, res, next) => (roles.includes(req.user.role) ? next() : next(forbidden())),
  ];
}

export function redirectIfAuthenticated(req, res, next) {
  if (req.user) return res.redirect(HOME_BY_ROLE[req.user.role]);
  next();
}

/** Signs a user in, regenerating the session id to prevent session fixation. */
export function signIn(req, user) {
  const returnTo = req.session.returnTo;
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.userId = user.id;
      const safeReturn = typeof returnTo === 'string' && returnTo.startsWith(HOME_BY_ROLE[user.role]);
      resolve(safeReturn ? returnTo : HOME_BY_ROLE[user.role]);
    });
  });
}
