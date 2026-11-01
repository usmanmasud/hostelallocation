import path from 'node:path';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { config, ROOT_DIR } from './config.js';
import { viewHelpers } from './lib/viewHelpers.js';
import { loadCurrentUser } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { csrfProtection, flashMessages } from './middleware/security.js';
import { SqliteSessionStore } from './middleware/sessionStore.js';
import accountRoutes from './routes/account.js';
import authRoutes from './routes/auth.js';
import hostelAdminRoutes from './routes/hostelAdmin.js';
import studentRoutes from './routes/student.js';
import systemAdminRoutes from './routes/systemAdmin.js';

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export function createApp() {
  const app = express();
  const sessionStore = new SqliteSessionStore();

  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT_DIR, 'src', 'views'));
  app.set('trust proxy', config.isProduction ? 1 : false);
  app.disable('x-powered-by');
  // Defaults keep templates renderable even when an error occurs before per-request locals are set.
  Object.assign(app.locals, viewHelpers, {
    appName: 'Smart Hostel',
    currentUser: null,
    unreadCount: 0,
    flash: [],
    csrfToken: '',
    currentPath: '',
  });

  app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': config.isProduction ? [] : null } } }));
  app.use('/static', express.static(path.join(ROOT_DIR, 'public'), { maxAge: config.isProduction ? '7d' : 0 }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(
    session({
      name: 'hostel.sid',
      secret: config.sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProduction, maxAge: SESSION_MAX_AGE_MS },
    }),
  );
  app.use(flashMessages);
  app.use(loadCurrentUser);
  app.use(csrfProtection);
  app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    next();
  });

  app.use('/', authRoutes);
  app.use('/', accountRoutes);
  app.use('/student', studentRoutes);
  app.use('/admin', hostelAdminRoutes);
  app.use('/system', systemAdminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals.sessionStore = sessionStore;
  return app;
}
