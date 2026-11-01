import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

let database = null;
let transactionDepth = 0;

function open(filePath) {
  if (filePath !== ':memory:') mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (filePath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return db;
}

/** Returns the shared database connection, opening (and migrating) it on first use. */
export function getDb() {
  if (!database) database = open(config.databasePath);
  return database;
}

export function closeDb() {
  if (database) {
    database.close();
    database = null;
    transactionDepth = 0;
  }
}

/**
 * Runs `work` inside a transaction. Nested calls become savepoints, so services can
 * compose each other freely; any thrown error rolls back to the matching level.
 */
export function transaction(work) {
  const db = getDb();
  const savepoint = `sp_${transactionDepth}`;
  db.exec(transactionDepth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  transactionDepth += 1;
  try {
    const result = work(db);
    transactionDepth -= 1;
    db.exec(transactionDepth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    transactionDepth -= 1;
    db.exec(transactionDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw error;
  }
}

const statementCache = new WeakMap();

/** Returns a prepared statement for `sql`, reusing it across calls on the same connection. */
export function statement(sql) {
  const db = getDb();
  let cache = statementCache.get(db);
  if (!cache) statementCache.set(db, (cache = new Map()));
  let prepared = cache.get(sql);
  if (!prepared) cache.set(sql, (prepared = db.prepare(sql)));
  return prepared;
}

/** SQLite cannot bind `undefined`; normalise optional values to NULL. */
export function nullable(value) {
  return value === undefined || value === '' ? null : value;
}
