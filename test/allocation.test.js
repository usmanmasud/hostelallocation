import { resetDatabase } from './setup.js';
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { ROLES } from '../src/lib/constants.js';
import { DomainError } from '../src/lib/errors.js';
import * as allocations from '../src/repositories/allocations.js';
import * as notifications from '../src/repositories/notifications.js';
import * as rooms from '../src/repositories/rooms.js';
import * as settings from '../src/repositories/settings.js';
import { runAllocation, selectCandidateRooms, vacateAllocation } from '../src/services/allocationService.js';
import { savePreferences } from '../src/services/hostelService.js';
import * as students from '../src/repositories/students.js';
import * as users from '../src/repositories/users.js';
import { LIVELY, QUIET, createRoom, createStaff, createStudent } from './fixtures.js';

beforeEach(resetDatabase);

const roomOf = (studentId) => allocations.findActiveByStudent(studentId)?.room_id;

describe('allocation service', () => {
  test('pairs compatible students together and records their scores', () => {
    createRoom();
    createRoom();
    const quiet1 = createStudent({ answers: QUIET });
    const lively1 = createStudent({ answers: LIVELY });
    const quiet2 = createStudent({ answers: QUIET });
    const lively2 = createStudent({ answers: LIVELY });

    const result = runAllocation();

    assert.equal(result.placedCount, 4);
    assert.equal(roomOf(quiet1.studentId), roomOf(quiet2.studentId));
    assert.equal(roomOf(lively1.studentId), roomOf(lively2.studentId));
    assert.notEqual(roomOf(quiet1.studentId), roomOf(lively1.studentId));
    assert.equal(allocations.findActiveByStudent(quiet1.studentId).compatibility_score, 100);
    assert.ok(rooms.list().every((room) => room.current_occupancy === 2));
  });

  test('never places students in a room of the other gender', () => {
    const maleRoom = createRoom({ hostelName: 'North Hall', gender: 'male', capacity: 4 });
    const femaleRoom = createRoom({ hostelName: 'South Hall', gender: 'female', capacity: 4 });
    const male = createStudent({ gender: 'male' });
    const female = createStudent({ gender: 'female' });

    runAllocation();

    assert.equal(roomOf(male.studentId), maleRoom);
    assert.equal(roomOf(female.studentId), femaleRoom);
  });

  test('skips students without preferences or with deactivated accounts', () => {
    createRoom({ capacity: 4 });
    const withoutPreferences = createStudent({ answers: null });
    const deactivated = createStudent();
    users.setActive(deactivated.userId, false);
    const ready = createStudent();

    const result = runAllocation();

    assert.equal(result.placedCount, 1);
    assert.ok(roomOf(ready.studentId));
    assert.equal(roomOf(withoutPreferences.studentId), undefined);
    assert.equal(roomOf(deactivated.studentId), undefined);
  });

  test('fills partly occupied rooms before opening empty ones', () => {
    const first = createRoom({ roomNumber: 'A1' });
    createRoom({ roomNumber: 'A2' });
    createStudent();
    runAllocation();
    assert.equal(rooms.findById(first).current_occupancy, 1);

    const second = createStudent();
    runAllocation();

    assert.equal(roomOf(second.studentId), first);
    assert.equal(rooms.findById(first).current_occupancy, 2);
  });

  test('reports students who cannot be placed when beds run out, earliest submissions first', () => {
    createRoom({ capacity: 2 });
    const early = [createStudent(), createStudent()];
    const lateStudent = createStudent();

    const result = runAllocation();

    assert.equal(result.placedCount, 2);
    assert.equal(result.unplacedCount, 1);
    assert.ok(early.every((s) => roomOf(s.studentId)));
    assert.equal(roomOf(lateStudent.studentId), undefined);
  });

  test('notifies the allocated students and the hostel administrators', () => {
    const adminId = createStaff(ROLES.HOSTEL_ADMIN);
    createRoom();
    const student = createStudent();

    runAllocation();

    assert.match(notifications.listForUser(student.userId)[0].subject, /allocated/);
    assert.match(notifications.listForUser(adminId)[0].subject, /New room allocation/);
  });

  test('vacating frees the bed and updates the remaining roommate score', () => {
    createRoom();
    const a = createStudent();
    const b = createStudent();
    runAllocation();
    const allocationA = allocations.findActiveByStudent(a.studentId);

    vacateAllocation(allocationA.id);

    assert.equal(rooms.findById(allocationA.room_id).current_occupancy, 1);
    assert.equal(allocations.findActiveByStudent(a.studentId), undefined);
    assert.equal(allocations.findActiveByStudent(b.studentId).compatibility_score, null);
    assert.throws(() => vacateAllocation(allocationA.id), DomainError);
  });

  test('instant mode allocates as soon as preferences are saved, then locks them', () => {
    settings.update({ allocationMode: 'instant' });
    createRoom();
    const { studentId } = createStudent({ answers: null });
    const student = students.findById(studentId);

    savePreferences(student, QUIET);

    assert.ok(roomOf(studentId));
    assert.throws(() => savePreferences(student, LIVELY), /locked/);
  });

  test('candidate rooms include every partial room plus just enough empty rooms', () => {
    const list = [
      { id: 1, capacity: 4, current_occupancy: 3 },
      { id: 2, capacity: 2, current_occupancy: 1 },
      { id: 3, capacity: 2, current_occupancy: 0 },
      { id: 4, capacity: 4, current_occupancy: 0 },
      { id: 5, capacity: 2, current_occupancy: 0 },
    ];
    assert.deepEqual(selectCandidateRooms(list, 1).map((r) => r.id), [1, 2]);
    assert.deepEqual(selectCandidateRooms(list, 4).map((r) => r.id), [1, 2, 3]);
    assert.deepEqual(selectCandidateRooms(list, 7).map((r) => r.id), [1, 2, 3, 4]);
  });
});
