import session from 'express-session';
import { statement } from '../db/connection.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Stores express-session data in the application's SQLite database. */
export class SqliteSessionStore extends session.Store {
  #expiresAt(sessionData) {
    const expires = sessionData?.cookie?.expires;
    return expires ? new Date(expires).getTime() : Date.now() + DEFAULT_TTL_MS;
  }

  get(sid, callback) {
    try {
      const row = statement('SELECT data, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row || row.expires_at <= Date.now()) return callback(null, null);
      callback(null, JSON.parse(row.data));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      statement(
        `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
         ON CONFLICT (sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
      ).run(sid, JSON.stringify(sessionData), this.#expiresAt(sessionData));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sessionData, callback = () => {}) {
    try {
      statement('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(this.#expiresAt(sessionData), sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      statement('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  pruneExpired() {
    statement('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  }
}
