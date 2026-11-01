import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, getDb } from './db/connection.js';
import { ensureBootstrapAdmin } from './services/accountService.js';
import { startEscalationScheduler } from './services/escalationService.js';

getDb();

const admin = await ensureBootstrapAdmin();
if (admin) {
  console.log('\nCreated the first System Administrator account:');
  console.log(`  Email:    ${admin.email}`);
  if (admin.generated) console.log(`  Password: ${admin.password}   (shown once — change it after signing in)`);
  console.log('');
}

const app = createApp();
const stopEscalation = startEscalationScheduler(config.escalationCheckMinutes);
const pruneSessions = setInterval(() => app.locals.sessionStore.pruneExpired(), 60 * 60 * 1000);
pruneSessions.unref();

const server = app.listen(config.port, () => {
  console.log(`Smart Hostel Allocation Management System running at http://localhost:${config.port}`);
  console.log(`Complaint escalation check runs every ${config.escalationCheckMinutes} minute(s).`);
});

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down…`);
  stopEscalation();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
