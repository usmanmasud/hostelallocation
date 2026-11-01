/**
 * Populates the database with demonstration data: staff accounts, two hostels, students
 * with varied preferences, a completed matching run, complaints (some old enough to be
 * escalated on the next check) and payment records.
 *
 *   npm run seed             # refuses to touch a database that already has users
 *   npm run seed -- --reset  # deletes the database file first
 */
import { existsSync, rmSync } from 'node:fs';
import { config } from '../config.js';
import { PREFERENCE_QUESTIONS, ROLES } from '../lib/constants.js';
import { hashPassword } from '../lib/password.js';
import { DAY_MS } from '../lib/time.js';
import * as allocations from '../repositories/allocations.js';
import * as complaints from '../repositories/complaints.js';
import * as payments from '../repositories/payments.js';
import * as preferences from '../repositories/preferences.js';
import * as rooms from '../repositories/rooms.js';
import * as settings from '../repositories/settings.js';
import * as students from '../repositories/students.js';
import * as users from '../repositories/users.js';
import { runAllocation } from '../services/allocationService.js';
import { closeDb, getDb, transaction } from './connection.js';

const STAFF_PASSWORD = 'Admin@1234';
const STUDENT_PASSWORD = 'Student@1234';

const MALE_NAMES = [
  'Abdullahi Musa', 'Chinedu Okafor', 'Tunde Adeyemi', 'Ibrahim Sani', 'Emeka Nwosu', 'Yusuf Bello',
  'Segun Ogunleye', 'Kelechi Eze', 'Usman Garba', 'Femi Adebayo', 'Aliyu Danjuma', 'Obinna Chukwu',
  'Bashir Lawal', 'David Okon', 'Sadiq Umar', 'Michael Etim', 'Haruna Idris', 'Samuel Ojo',
];
const FEMALE_NAMES = [
  'Aisha Mohammed', 'Ngozi Okeke', 'Funmilayo Ade', 'Zainab Yusuf', 'Chiamaka Obi', 'Hauwa Ibrahim',
  'Bukola Alade', 'Amaka Nnaji', 'Fatima Abubakar', 'Grace Edet', 'Maryam Suleiman', 'Kemi Oladipo',
  'Halima Shehu', 'Blessing Udo',
];
const COURSES = ['Computer Science', 'Information Technology', 'Software Engineering', 'Accounting', 'Economics', 'Mass Communication'];

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function resetDatabase() {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${config.databasePath}${suffix}`;
    if (existsSync(file)) rmSync(file);
  }
}

function emailFor(name) {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@student.local`;
}

/** Preferences drawn from a few lifestyle "profiles" so some students are clearly compatible. */
function randomPreferences(random) {
  const pick = (options) => options[Math.floor(random() * options.length)].value;
  const answers = {};
  for (const q of PREFERENCE_QUESTIONS) answers[q.key] = pick(q.options);
  if (random() < 0.5) {
    const quiet = random() < 0.5;
    answers.sleepSchedule = quiet ? 'early' : 'late';
    answers.noiseTolerance = quiet ? 'quiet' : 'lively';
    answers.socialStyle = quiet ? 'reserved' : 'outgoing';
  }
  return answers;
}

async function seed() {
  if (process.argv.includes('--reset')) resetDatabase();
  getDb();
  if (users.list().length > 0) {
    console.error('The database already contains users. Run `npm run seed -- --reset` to start from scratch.');
    process.exitCode = 1;
    return;
  }

  const staffHash = await hashPassword(STAFF_PASSWORD);
  const studentHash = await hashPassword(STUDENT_PASSWORD);
  const random = seededRandom(2026);
  const now = Date.now();

  settings.update({ escalationDays: 3, hostelFee: 45000, allocationMode: 'batch' });

  const studentIds = transaction(() => {
    users.create({ name: 'System Administrator', email: 'admin@hostel.local', passwordHash: staffHash, role: ROLES.SYSTEM_ADMIN });
    users.create({ name: 'Hostel Administrator', email: 'hostel.admin@hostel.local', passwordHash: staffHash, role: ROLES.HOSTEL_ADMIN });

    const hostels = [
      { name: 'Unity Hall', gender: 'male', prefix: 'U' },
      { name: 'Excellence Hall', gender: 'female', prefix: 'E' },
    ];
    for (const hostel of hostels) {
      for (let i = 1; i <= 10; i += 1) {
        rooms.create({
          hostelName: hostel.name,
          roomNumber: `${hostel.prefix}${100 + i}`,
          gender: hostel.gender,
          capacity: i <= 6 ? 2 : 4,
        });
      }
    }

    const roster = [
      ...MALE_NAMES.map((name) => ({ name, gender: 'male' })),
      ...FEMALE_NAMES.map((name) => ({ name, gender: 'female' })),
    ];
    return roster.map(({ name, gender }, index) => {
      const userId = users.create({ name, email: emailFor(name), passwordHash: studentHash, role: ROLES.STUDENT });
      const studentId = students.create({
        userId,
        matricNumber: `UG/2026/${String(index + 1).padStart(3, '0')}`,
        gender,
        course: COURSES[Math.floor(random() * COURSES.length)],
        level: [100, 200, 300, 400][Math.floor(random() * 4)],
        phone: `080${String(30000000 + index * 7919).slice(0, 8)}`,
      });
      payments.createForStudent(studentId, 45000);
      return { studentId, gender, index };
    });
  });

  // Most students submit preferences before the first matching run.
  const late = new Set([16, 17, 30, 31]);
  const noPreferences = new Set([15, 29]);
  for (const s of studentIds) {
    if (!late.has(s.index) && !noPreferences.has(s.index)) preferences.upsert(s.studentId, randomPreferences(random));
  }
  const run = runAllocation();

  // A few students submit after the run and are left waiting for the next one.
  for (const s of studentIds) if (late.has(s.index)) preferences.upsert(s.studentId, randomPreferences(random));

  transaction(() => {
    const statuses = ['paid', 'paid', 'paid', 'pending', 'unpaid'];
    for (const s of studentIds) {
      const status = statuses[s.index % statuses.length];
      payments.update(s.studentId, {
        amount: 45000,
        status,
        reference: status === 'paid' ? `RCPT-${10450 + s.index}` : null,
        note: status === 'pending' ? 'Bank transfer awaiting confirmation.' : null,
        updatedBy: null,
      });
    }

    const at = (daysAgo) => new Date(now - daysAgo * DAY_MS).toISOString();
    const sample = [
      { index: 0, category: 'plumbing', title: 'Bathroom tap is leaking', description: 'The tap in our bathroom has been dripping constantly since last week and the floor stays wet.', daysAgo: 5 },
      { index: 2, category: 'electrical', title: 'Ceiling fan not working', description: 'The ceiling fan stopped working completely. The switch works but the fan does not turn.', daysAgo: 4, status: 'in_progress', response: 'Electrician has been informed.' },
      { index: 4, category: 'furniture', title: 'Broken wardrobe door', description: 'One wardrobe door came off its hinges and cannot be closed.', daysAgo: 1 },
      { index: 18, category: 'electrical', title: 'Faulty socket near the window', description: 'The wall socket near the window sparks when anything is plugged in. It is unsafe.', daysAgo: 6, status: 'resolved', response: 'The socket was replaced by the maintenance team.' },
      { index: 20, category: 'cleaning', title: 'Corridor bins not emptied', description: 'The waste bins on our corridor have not been emptied for several days and smell badly.', daysAgo: 0.5 },
    ];
    for (const item of sample) {
      const student = studentIds[item.index];
      const allocation = allocations.findActiveByStudent(student.studentId);
      if (!allocation) continue;
      const id = complaints.create({
        studentId: student.studentId,
        roomId: allocation.room_id,
        category: item.category,
        title: item.title,
        description: item.description,
        submittedAt: at(item.daysAgo),
      });
      if (item.status) complaints.updateByAdmin(id, { status: item.status, adminResponse: item.response });
    }
  });

  console.log('Demo data created.\n');
  console.log(`  System Administrator   admin@hostel.local          ${STAFF_PASSWORD}`);
  console.log(`  Hostel Administrator   hostel.admin@hostel.local   ${STAFF_PASSWORD}`);
  console.log(`  Student (example)      ${emailFor(MALE_NAMES[0]).padEnd(27)} ${STUDENT_PASSWORD}`);
  console.log(`  All ${studentIds.length} students use the password ${STUDENT_PASSWORD}.\n`);
  console.log(`  Matching run placed ${run.placedCount} students; ${late.size} more are waiting for the next run.`);
  console.log('  Two complaints are past the 3-day limit and will be escalated when the server starts.');
}

await seed();
closeDb();
