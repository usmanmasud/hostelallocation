import { resetDatabase } from './setup.js';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/lib/constants.js';
import { hashPassword } from '../src/lib/password.js';
import * as users from '../src/repositories/users.js';

let server;
let baseUrl;

/** A minimal browser: keeps cookies, reads CSRF tokens from pages and never follows redirects. */
class Browser {
  cookies = new Map();
  csrf = '';

  async request(method, path, form) {
    const headers = { Accept: 'text/html', Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ _csrf: this.csrf, ...form }).toString();
    }
    const response = await fetch(baseUrl + path, { method, headers, body, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, value] = pair.split('=');
      this.cookies.set(name, value);
    }
    const text = await response.text();
    const token = text.match(/name="_csrf" value="([^"]+)"/);
    if (token) this.csrf = token[1];
    return { status: response.status, location: response.headers.get('location'), text };
  }

  get(path) {
    return this.request('GET', path);
  }

  post(path, form = {}) {
    return this.request('POST', path, form);
  }

  async login(email, password) {
    await this.get('/login');
    return this.post('/login', { email, password });
  }
}

before(async () => {
  resetDatabase();
  const passwordHash = await hashPassword('Staff@1234');
  users.create({ name: 'Sys Admin', email: 'sys@test.local', passwordHash, role: ROLES.SYSTEM_ADMIN });
  users.create({ name: 'Hostel Admin', email: 'hostel@test.local', passwordHash, role: ROLES.HOSTEL_ADMIN });
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

const PREFERENCES = { sleepSchedule: 'early', cleanliness: 'very_tidy', noiseTolerance: 'quiet', studyHabits: 'in_room', socialStyle: 'reserved' };

async function registerStudent(browser, overrides = {}) {
  await browser.get('/register');
  return browser.post('/register', {
    name: 'Amina Bello',
    email: 'amina@test.local',
    matricNumber: 'csc/2026/001',
    gender: 'female',
    course: 'Computer Science',
    level: '100',
    phone: '08012345678',
    password: 'Student123',
    confirmPassword: 'Student123',
    ...overrides,
  });
}

describe('end-to-end workflow', () => {
  const student = new Browser();
  const admin = new Browser();
  const system = new Browser();

  test('anonymous visitors are sent to the sign-in page', async () => {
    const response = await new Browser().get('/student');
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
  });

  test('registration validates input and creates the account', async () => {
    const invalid = await registerStudent(student, { email: 'not-an-email', confirmPassword: 'different1' });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /not a valid email address/);
    assert.match(invalid.text, /Passwords do not match/);

    const created = await registerStudent(student);
    assert.equal(created.status, 302);
    assert.equal(created.location, '/login');

    const duplicate = await registerStudent(new Browser());
    assert.equal(duplicate.status, 409);
  });

  test('form submissions without a valid CSRF token are rejected', async () => {
    const browser = new Browser();
    await browser.get('/login');
    browser.csrf = 'forged';
    const response = await browser.post('/login', { email: 'amina@test.local', password: 'Student123' });
    assert.equal(response.status, 403);
  });

  test('wrong passwords are refused and repeated failures are throttled', async () => {
    const browser = new Browser();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await browser.login('nobody@test.local', 'wrong-password')).status, 401);
    }
    const blocked = await browser.login('nobody@test.local', 'wrong-password');
    assert.equal(blocked.status, 429);
    assert.match(blocked.text, /Too many failed attempts/);
  });

  test('a student signs in and submits preferences', async () => {
    const login = await student.login('amina@test.local', 'Student123');
    assert.equal(login.location, '/student');

    const dashboard = await student.get('/student');
    assert.match(dashboard.text, /CSC\/2026\/001/);
    assert.match(dashboard.text, /fill in your room preferences/i);

    const incomplete = await student.post('/student/preferences', { sleepSchedule: 'early' });
    assert.equal(incomplete.status, 422);

    const saved = await student.post('/student/preferences', PREFERENCES);
    assert.equal(saved.status, 302);
  });

  test('students cannot open administrator pages', async () => {
    assert.equal((await student.get('/admin')).status, 403);
    assert.equal((await student.get('/system/users')).status, 403);
  });

  test('the hostel administrator adds a room and runs matching', async () => {
    assert.equal((await admin.login('hostel@test.local', 'Staff@1234')).location, '/admin');

    await admin.get('/admin/rooms');
    const room = await admin.post('/admin/rooms', { hostelName: 'Excellence Hall', roomNumber: 'E1', gender: 'female', capacity: '2' });
    assert.equal(room.status, 302);
    await admin.get('/admin/rooms');
    const wrongGender = await admin.post('/admin/rooms', { hostelName: 'Excellence Hall', roomNumber: 'E2', gender: 'male', capacity: '2' });
    assert.equal(wrongGender.status, 302);
    assert.match((await admin.get('/admin/rooms')).text, /is a female hostel/);

    await admin.get('/admin/allocations');
    const run = await admin.post('/admin/allocations/run');
    assert.equal(run.location, '/admin/allocations');
    const page = await admin.get('/admin/allocations');
    assert.match(page.text, /Students allocated<\/dt><dd>1/);

    const stats = JSON.parse((await admin.get('/admin/occupancy.json')).text);
    assert.equal(stats.occupiedBeds, 1);
    assert.equal(stats.beds, 2);
  });

  test('the student sees the allocation and can no longer change preferences', async () => {
    const page = await student.get('/student/allocation');
    assert.match(page.text, /Excellence Hall — Room E1/);
    assert.match((await student.get('/student/preferences')).text, /preferences are locked/);
    assert.match((await student.get('/notifications')).text, /Your hostel room has been allocated/);
  });

  test('complaints flow from the student to the administrator and back', async () => {
    await student.get('/student/complaints/new');
    const submitted = await student.post('/student/complaints', {
      category: 'plumbing',
      title: 'Leaking bathroom tap',
      description: 'The bathroom tap has been leaking for two days.',
    });
    assert.equal(submitted.status, 302);
    const complaintPath = submitted.location;
    const id = complaintPath.split('/').pop();

    await admin.get(`/admin/complaints/${id}`);
    const missingResponse = await admin.post(`/admin/complaints/${id}`, { status: 'resolved', adminResponse: '' });
    assert.equal(missingResponse.status, 422);
    const resolved = await admin.post(`/admin/complaints/${id}`, { status: 'resolved', adminResponse: 'Washer replaced.' });
    assert.equal(resolved.status, 302);

    const view = await student.get(complaintPath);
    assert.match(view.text, /Resolved/);
    assert.match(view.text, /Washer replaced\./);
  });

  test('students only see their own complaints', async () => {
    const other = new Browser();
    await registerStudent(other, { email: 'other@test.local', matricNumber: 'CSC/2026/002' });
    await other.login('other@test.local', 'Student123');
    assert.equal((await other.get('/student/complaints/1')).status, 404);
  });

  test('the administrator records a payment and the student sees it', async () => {
    const studentRow = users.list({ search: 'amina@test.local' })[0];
    const { findByUserId } = await import('../src/repositories/students.js');
    const profile = findByUserId(studentRow.id);

    await admin.get(`/admin/payments/${profile.id}`);
    const updated = await admin.post(`/admin/payments/${profile.id}`, { amount: '45000', status: 'paid', reference: 'RCPT-1', note: '' });
    assert.equal(updated.status, 302);

    const page = await student.get('/student/payment');
    assert.match(page.text, /Paid/);
    assert.match(page.text, /RCPT-1/);
  });

  test('the system administrator updates settings and deactivates an account', async () => {
    assert.equal((await system.login('sys@test.local', 'Staff@1234')).status, 302);
    assert.equal((await system.get('/admin')).status, 403);

    await system.get('/system/settings');
    const invalid = await system.post('/system/settings', { escalationDays: '0' });
    assert.equal(invalid.status, 422);
    const saved = await system.post('/system/settings', {
      escalationDays: '5',
      deanName: 'Prof. Dean',
      deanEmail: 'dean@school.edu',
      hostelFee: '50000',
      currency: 'ngn',
      academicSession: '2026/2027',
      allocationMode: 'batch',
      courses: 'Computer Science\nLaw\nLaw',
    });
    assert.equal(saved.status, 302);
    assert.match((await system.get('/system/settings')).text, /value="5"/);

    const studentUser = users.list({ search: 'amina@test.local' })[0];
    await system.get(`/system/users/${studentUser.id}`);
    await system.post(`/system/users/${studentUser.id}/status`, { active: '0' });

    const afterDeactivation = await student.get('/student');
    assert.equal(afterDeactivation.status, 302, 'a deactivated user is signed out on the next request');
    const relogin = await new Browser().login('amina@test.local', 'Student123');
    assert.equal(relogin.status, 401);
    assert.match(relogin.text, /deactivated/);
  });

  test('the last System Administrator cannot be deactivated', async () => {
    const self = users.list({ search: 'sys@test.local' })[0];
    await system.get(`/system/users/${self.id}`);
    await system.post(`/system/users/${self.id}/status`, { active: '0' });
    assert.equal(users.findById(self.id).is_active, 1);
  });

  test('unknown pages return 404', async () => {
    assert.equal((await system.get('/does-not-exist')).status, 404);
  });
});
