-- Smart Hostel Allocation Management System — database schema.
--
-- Core tables (Table 3.1): users, student_profiles, preferences, rooms,
-- allocations, complaints, payments.
-- Supporting tables: settings (system configuration), notifications
-- (in-app messages and the email outbox) and sessions (login sessions).
--
-- All timestamps are ISO-8601 UTC strings produced by the application.

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY,
  name           TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT    NOT NULL,
  role           TEXT    NOT NULL CHECK (role IN ('student', 'hostel_admin', 'system_admin')),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     TEXT    NOT NULL,
  last_login_at  TEXT
);

CREATE TABLE IF NOT EXISTS student_profiles (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  matric_number  TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  gender         TEXT    NOT NULL CHECK (gender IN ('male', 'female')),
  course         TEXT    NOT NULL,
  level          INTEGER NOT NULL CHECK (level IN (100, 200, 300, 400, 500)),
  phone          TEXT
);

CREATE TABLE IF NOT EXISTS preferences (
  id               INTEGER PRIMARY KEY,
  student_id       INTEGER NOT NULL UNIQUE REFERENCES student_profiles (id) ON DELETE CASCADE,
  sleep_schedule   TEXT    NOT NULL,
  cleanliness      TEXT    NOT NULL,
  noise_tolerance  TEXT    NOT NULL,
  study_habits     TEXT    NOT NULL,
  social_style     TEXT    NOT NULL,
  other_notes      TEXT,
  submitted_at     TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id                 INTEGER PRIMARY KEY,
  hostel_name        TEXT    NOT NULL,
  room_number        TEXT    NOT NULL,
  gender             TEXT    NOT NULL CHECK (gender IN ('male', 'female')),
  capacity           INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 12),
  current_occupancy  INTEGER NOT NULL DEFAULT 0
                     CHECK (current_occupancy >= 0 AND current_occupancy <= capacity),
  created_at         TEXT    NOT NULL,
  UNIQUE (hostel_name, room_number)
);

-- An allocation row is "active" while vacated_at is NULL; vacated rows are kept as history.
CREATE TABLE IF NOT EXISTS allocations (
  id                   INTEGER PRIMARY KEY,
  student_id           INTEGER NOT NULL REFERENCES student_profiles (id) ON DELETE CASCADE,
  room_id              INTEGER NOT NULL REFERENCES rooms (id) ON DELETE RESTRICT,
  compatibility_score  REAL CHECK (compatibility_score IS NULL OR compatibility_score BETWEEN 0 AND 100),
  allocated_at         TEXT    NOT NULL,
  batch_id             TEXT,
  vacated_at           TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_allocations_active_student
  ON allocations (student_id) WHERE vacated_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_allocations_room ON allocations (room_id) WHERE vacated_at IS NULL;

CREATE TABLE IF NOT EXISTS complaints (
  id                INTEGER PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES student_profiles (id) ON DELETE CASCADE,
  room_id           INTEGER REFERENCES rooms (id) ON DELETE SET NULL,
  category          TEXT    NOT NULL,
  title             TEXT    NOT NULL,
  description       TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'escalated', 'resolved')),
  escalation_level  INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level >= 0),
  admin_response    TEXT,
  submitted_at      TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  escalated_at      TEXT,
  resolved_at       TEXT
);
CREATE INDEX IF NOT EXISTS ix_complaints_open ON complaints (status, submitted_at);
CREATE INDEX IF NOT EXISTS ix_complaints_student ON complaints (student_id);

CREATE TABLE IF NOT EXISTS payments (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER NOT NULL UNIQUE REFERENCES student_profiles (id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL CHECK (amount >= 0),
  status      TEXT    NOT NULL DEFAULT 'unpaid' CHECK (status IN ('paid', 'unpaid', 'pending')),
  reference   TEXT,
  note        TEXT,
  updated_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- channel 'in_app' rows belong to a user; channel 'email' rows form the outbox.
CREATE TABLE IF NOT EXISTS notifications (
  id               INTEGER PRIMARY KEY,
  user_id          INTEGER REFERENCES users (id) ON DELETE CASCADE,
  channel          TEXT    NOT NULL CHECK (channel IN ('in_app', 'email')),
  recipient        TEXT,
  subject          TEXT    NOT NULL,
  body             TEXT    NOT NULL,
  link             TEXT,
  is_read          INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  delivery_status  TEXT CHECK (delivery_status IS NULL OR delivery_status IN ('queued', 'sent', 'logged', 'failed')),
  delivery_error   TEXT,
  created_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications (user_id, is_read);

CREATE TABLE IF NOT EXISTS sessions (
  sid         TEXT PRIMARY KEY,
  data        TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions (expires_at);
