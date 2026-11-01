// Imported first by every test file: configures an isolated in-memory database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.SMTP_HOST = '';

const { closeDb, getDb } = await import('../src/db/connection.js');

/** Replaces the database with a fresh, empty one. */
export function resetDatabase() {
  closeDb();
  getDb();
}
