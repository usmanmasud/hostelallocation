import { DomainError, notFound } from '../lib/errors.js';

/** Returns the same-site path of the Referer header, falling back to `fallback`. */
function backPath(req, fallback) {
  try {
    const referer = new URL(req.get('referer') ?? '', `${req.protocol}://${req.get('host')}`);
    return referer.host === req.get('host') ? `${referer.pathname}${referer.search}` : fallback;
  } catch {
    return fallback;
  }
}

export function notFoundHandler(req, res, next) {
  next(notFound());
}

/**
 * Business-rule failures on form submissions become a flash message on the previous page;
 * HTTP errors render the error page; anything else is logged and shown as a generic 500.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  if (error instanceof DomainError && req.method === 'POST') {
    req.flash('error', error.message);
    return res.redirect(backPath(req, '/'));
  }

  const status = error.status ?? (error instanceof DomainError ? 400 : 500);
  if (status >= 500) console.error(error);
  const message = error.expose || error instanceof DomainError ? error.message : 'Something went wrong on our side. Please try again.';

  res.status(status);
  if (req.accepts(['html', 'json']) === 'json') return res.json({ error: message });
  res.render('shared/error', { title: status === 404 ? 'Page not found' : 'Error', status, message });
}
