# Smart Hostel Allocation Management System

A web-based platform for students and hostel administrators that:

- **matches students to rooms and roommates by preference**, using a compatibility score;
- **escalates unresolved complaints automatically** to the Dean of Student Affairs after a set time limit;
- **tracks payment status** (Paid / Pending / Unpaid) for every student;
- shows hostel administrators a **real-time occupancy dashboard**.

"Smart" here means the system makes decisions automatically by following clear rules. It does not use artificial intelligence or machine learning.

---

## Quick start

Requirements: **Node.js 22.13 or newer** (the built-in `node:sqlite` module is used, so no database server or native build tools are needed).

```bash
npm install
npm run seed      # optional: loads demonstration data
npm start         # http://localhost:3000
```

Demo accounts created by `npm run seed`:

| Role | Email | Password |
| --- | --- | --- |
| System Administrator | `admin@hostel.local` | `Admin@1234` |
| Hostel Administrator | `hostel.admin@hostel.local` | `Admin@1234` |
| Student (any of 32) | e.g. `abdullahi.musa@student.local` | `Student@1234` |

The seed data includes two hostels, a completed matching run, four students still waiting for a room, and two complaints that are past the 3-day limit, so they are escalated as soon as the server starts. Run `npm run seed -- --reset` to start again from scratch.

Without seed data, the first start creates a System Administrator from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`. If no password is set, a random one is generated and printed once to the console.

Other commands:

```bash
npm run dev       # restart automatically on file changes
npm test          # run the automated test suite (40 tests)
```

---

## Users and what they can do

| Role | Capabilities |
| --- | --- |
| **Student** | Register, submit room preferences, view room, roommates and compatibility score (with a per-criterion breakdown), report and track complaints, view payment status, receive notifications. |
| **Hostel Administrator** | Live occupancy dashboard, run the matching engine, view the allocation record and vacate beds, manage rooms, review and resolve complaints, update payment status, view all students. |
| **System Administrator / Coordinator** | Manage user accounts (create staff, edit, activate/deactivate, reset passwords), configure the escalation time limit, the Dean's contact details, allocation mode, hostel fee, academic session and course list; view the escalation email log and trigger an escalation check. |
| **Dean of Student Affairs** | Not a system user. Receives an email when a complaint is escalated. |

Each role sees only its own area. Requests to another role's pages return *403 Access denied*.

---

## How the objectives are met

| Objective (Chapter 1) | Implementation |
| --- | --- |
| 1. Separate access for students and administrators | Role-based routes (`/student`, `/admin`, `/system`) guarded by `requireRole` — [src/middleware/auth.js](src/middleware/auth.js) |
| 2. Preference-based room and roommate matching | [src/services/matching/compatibility.js](src/services/matching/compatibility.js), [src/services/matching/optimizer.js](src/services/matching/optimizer.js), [src/services/allocationService.js](src/services/allocationService.js) |
| 3. Automatic complaint escalation | [src/services/escalationService.js](src/services/escalationService.js) (background job plus a manual trigger) |
| 4. Payment status tracking | [src/repositories/payments.js](src/repositories/payments.js), admin `/admin/payments`, student `/student/payment` |
| 5. Real-time occupancy dashboard | [src/services/dashboardService.js](src/services/dashboardService.js); `/admin` polls `/admin/occupancy.json` every 15 seconds |

### Compatibility score (section 3.3.5)

Two students are compared on six criteria: **course of study**, **sleep schedule**, **cleanliness level**, **noise tolerance**, **study habits** and **social style**. Every student answers the same questions. The score is the percentage of criteria on which both students gave the same answer. For example, 3 of 5 matching criteria gives 60%, as in Table 3.2.

A student's own score is the average of their scores with each roommate. It is recalculated whenever someone joins or leaves the room.

### Choosing the arrangement (Tables 3.3 and 3.4)

The engine does not pair students one at a time. For every student waiting for a room, it chooses the arrangement with the **highest total compatibility**, meaning the sum of the scores of every pair of roommates.

1. Students are grouped by gender, because each hostel is reserved for one gender.
2. The candidate rooms are every partly filled room (existing occupants stay where they are and get roommates first), plus just enough empty rooms to give everyone a bed.
3. Small groups are solved **exactly** by exhaustive search. Interchangeable empty rooms are treated as one to avoid repeated work. Larger groups use a **greedy start improved by moves and swaps** until no change helps, repeated from several seeded orders, so results are reproducible. On random instances this matches the exhaustive optimum (see the tests), and it places 400 students in well under a second.
4. Every student is placed while beds remain. A student with low scores everywhere still gets the best available room. If beds run out, the students who submitted preferences earliest are placed, and the administrator is told who is still waiting.

Two allocation modes can be configured. In **Batch** mode (the default), the administrator runs matching for a whole group. In **Instant** mode, matching runs as soon as a student submits preferences, as in the sequence diagram in Figure 3.2. Preferences are locked once a room is allocated.

### Complaint escalation

A complaint is *due* when it is unresolved (Pending or In progress), has not been escalated, and was submitted at least the configured number of days ago. A background job checks every `ESCALATION_CHECK_MINUTES`. System Administrators can also run the check on demand. When a complaint is escalated:

- its status becomes **Escalated** and its escalation level rises to 1;
- the Dean is emailed its full details (via SMTP when configured; otherwise the email is recorded in the outbox as *logged*);
- the hostel administrators and the student are notified in the app.

The update re-checks the complaint's state in the same SQL statement, so each complaint is escalated exactly once. Escalated complaints can still be resolved by the hostel administrator, and the escalation history is kept.

---

## Architecture

The project follows the three-tier design in section 3.3.2:

```
src/
  views/            Presentation layer: EJS templates (HTML), public/css, public/js
  routes/           Request handling and input validation for each role
  services/         Application/logic layer
    matching/         compatibility score and arrangement optimiser (pure, no database)
    allocationService.js, escalationService.js, hostelService.js,
    accountService.js, dashboardService.js, notificationService.js
  repositories/     Data layer: all SQL lives here
  db/               schema.sql, connection and transactions, seed script
  middleware/       authentication, CSRF, flash messages, sessions, errors
  lib/              constants, validation, password hashing, view helpers
test/               node:test suites (unit, service and end-to-end HTTP)
```

Stack: Node.js, Express 5, EJS (server-rendered HTML/CSS/JavaScript) and SQLite (relational).

### Database

The schema is in [src/db/schema.sql](src/db/schema.sql) and is applied automatically on start-up.

| Table | Purpose |
| --- | --- |
| `users` | Login and role for every user |
| `student_profiles` | Matric number, gender, course, level, phone |
| `preferences` | Lifestyle answers used for matching |
| `rooms` | Hostel name, room number, gender, capacity, current occupancy |
| `allocations` | Student ↔ room with compatibility score; vacated rows are kept as history |
| `complaints` | Category, description, status, escalation level and timestamps |
| `payments` | Amount, status, reference and who last updated it |
| `settings` | Escalation limit, Dean contact, fee, session, allocation mode, courses |
| `notifications` | In-app notifications and the email outbox |
| `sessions` | Sign-in sessions |

The first seven tables are the ones in Table 3.1. Three changes go beyond that table: `gender` is stored on profiles and rooms so hostels stay single-gender, complaints gain an *In progress* status, and three supporting tables are added (settings, notifications, sessions).

### Security

- Passwords are hashed with scrypt and a per-user salt.
- Sessions are stored in the database, with HTTP-only, SameSite cookies (also Secure in production). The session id is regenerated at sign-in.
- Every form is protected by a CSRF token. Security headers and a Content Security Policy come from Helmet.
- Failed sign-ins are throttled (5 attempts per 15 minutes for each IP address and email). A deactivated account is signed out on its next request.
- All SQL uses bound parameters, and all output is HTML-escaped by EJS.

---

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | Set `production` for secure cookies and caching |
| `SESSION_SECRET` | random (dev only) | **Required in production** |
| `DATABASE_PATH` | `data/hostel.db` | SQLite file |
| `APP_TIMEZONE` | `Africa/Lagos` | Time zone for displayed dates |
| `ESCALATION_CHECK_MINUTES` | `15` | How often unresolved complaints are checked |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | `admin@hostel.local` / random | First System Administrator |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | empty | Email delivery to the Dean |

Settings that change during a session (escalation days, Dean details, fee, allocation mode, courses) are edited in the app under **System settings**.

---

## Deploying to Render

The repository includes a Render Blueprint ([render.yaml](render.yaml)).

1. In the Render dashboard choose **New → Blueprint** and select this GitHub repository.
2. When prompted, enter a strong `BOOTSTRAP_ADMIN_PASSWORD`. `SESSION_SECRET` is generated automatically.
3. Click **Apply**. Render installs dependencies, starts the app and checks `/healthz`.
4. Sign in at the `.onrender.com` URL as `admin@hostel.local` with the password from step 2. Then create a Hostel Administrator account and add rooms.

**Data persistence:** the free plan has no persistent disk, so the SQLite database is reset on every deploy and restart. Free services also restart after about 15 minutes without traffic. This is fine for a demonstration. To keep data, switch to a paid plan and enable the disk block that is commented out in `render.yaml` (mounted at `/var/data`, with `DATABASE_PATH=/var/data/hostel.db`).

Do not run `npm run seed` on a public deployment. Its demo passwords are listed in this README.

---

## Scope and limitations

These follow section 1.4 of the report:

- The payment feature records and displays status only. It does not process payments or connect to a payment gateway.
- Matching depends on the answers students give, so it cannot guarantee that roommates will get along.
- There is no visitor tracking, biometric access or separate mobile app. The site is responsive and works on phones.
- The login throttle is held in memory, which suits the intended single-server deployment.
