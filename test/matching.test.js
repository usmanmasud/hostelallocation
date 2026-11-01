import './setup.js';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CRITERIA, compareProfiles, personalScore } from '../src/services/matching/compatibility.js';
import { arrangementTotal, optimizeAssignment } from '../src/services/matching/optimizer.js';

describe('compatibility score', () => {
  test('reproduces the worked example in Table 3.2 (3 of 5 criteria = 60%)', () => {
    const criteria = [
      { key: 'sleepSchedule', label: 'Sleep schedule' },
      { key: 'cleanliness', label: 'Cleanliness level' },
      { key: 'noiseTolerance', label: 'Noise tolerance' },
      { key: 'studyHabits', label: 'Study habits' },
      { key: 'course', label: 'Course of study' },
    ];
    const studentA = { sleepSchedule: 'early', cleanliness: 'very_tidy', noiseTolerance: 'quiet', studyHabits: 'in_room', course: 'Information Technology' };
    const studentB = { sleepSchedule: 'early', cleanliness: 'moderately_tidy', noiseTolerance: 'quiet', studyHabits: 'in_room', course: 'Computer Science' };

    const result = compareProfiles(studentA, studentB, criteria);

    assert.equal(result.matched, 3);
    assert.equal(result.total, 5);
    assert.equal(result.score, 60);
    assert.deepEqual(result.breakdown.map((item) => item.match), [true, false, true, true, false]);
  });

  test('uses course of study plus every preference question', () => {
    assert.deepEqual(CRITERIA.map((c) => c.key), ['course', 'sleepSchedule', 'cleanliness', 'noiseTolerance', 'studyHabits', 'socialStyle']);
  });

  test('ignores case and surrounding spaces, and never matches missing answers', () => {
    const criteria = [{ key: 'course' }, { key: 'sleepSchedule' }];
    assert.equal(compareProfiles({ course: ' computer science ' }, { course: 'Computer Science' }, criteria).matched, 1);
    assert.equal(compareProfiles({ course: null, sleepSchedule: null }, { course: null, sleepSchedule: null }, criteria).score, 0);
  });

  test('personal score is the mean compatibility with roommates, or null when alone', () => {
    const criteria = [{ key: 'a' }, { key: 'b' }];
    const me = { a: 1, b: 1 };
    assert.equal(personalScore(me, [{ a: 1, b: 1 }, { a: 1, b: 2 }], criteria), 75);
    assert.equal(personalScore(me, [], criteria), null);
  });
});

/** Table 3.3 — compatibility scores for four students A, B, C, D (indices 0..3). */
const TABLE_3_3 = { '0-1': 80, '0-2': 60, '0-3': 20, '1-2': 40, '1-3': 30, '2-3': 30 };
const tableScore = (i, j) => TABLE_3_3[`${Math.min(i, j)}-${Math.max(i, j)}`];
const twoDoubleRooms = () => [{ freeSlots: 2, occupants: [] }, { freeSlots: 2, occupants: [] }];

function roommatesOf(assignment) {
  const groups = new Map();
  assignment.forEach((room, student) => groups.set(room, [...(groups.get(room) ?? []), student]));
  return [...groups.values()].map((group) => group.sort().join('')).sort();
}

describe('room arrangement optimiser', () => {
  test('selects arrangement 1 from Table 3.4 (A+B, C+D, total 110)', () => {
    for (const strategy of ['exhaustive', 'local_search']) {
      const result = optimizeAssignment({ studentCount: 4, rooms: twoDoubleRooms(), score: tableScore, strategy });
      assert.equal(result.total, 110, strategy);
      assert.deepEqual(roommatesOf(result.assignment), ['01', '23'], strategy);
    }
  });

  test('places every student even when their scores are low (student D)', () => {
    const { assignment } = optimizeAssignment({ studentCount: 4, rooms: twoDoubleRooms(), score: tableScore });
    assert.equal(assignment.length, 4);
    assert.ok(assignment.every((room) => room === 0 || room === 1));
  });

  test('keeps existing occupants in place and gives them the most compatible newcomer', () => {
    // Person 2 already lives in room 0; students 0 and 1 are new.
    const score = (i, j) => ({ '0-2': 90, '1-2': 10, '0-1': 50 })[`${Math.min(i, j)}-${Math.max(i, j)}`];
    const rooms = [{ freeSlots: 1, occupants: [2] }, { freeSlots: 2, occupants: [] }];
    const { assignment } = optimizeAssignment({ studentCount: 2, rooms, score });
    assert.equal(assignment[0], 0);
    assert.equal(assignment[1], 1);
  });

  test('never exceeds room capacity', () => {
    const rooms = [{ freeSlots: 3, occupants: [] }, { freeSlots: 1, occupants: [] }, { freeSlots: 2, occupants: [] }];
    const { assignment } = optimizeAssignment({ studentCount: 6, rooms, score: () => 50 });
    const counts = rooms.map((_, room) => assignment.filter((r) => r === room).length);
    assert.deepEqual(counts, [3, 1, 2]);
  });

  test('rejects more students than free beds', () => {
    assert.throws(() => optimizeAssignment({ studentCount: 3, rooms: [{ freeSlots: 2, occupants: [] }], score: () => 0 }), RangeError);
  });

  test('local search finds the exhaustive optimum on random small instances', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 25; trial += 1) {
      const studentCount = 6 + (trial % 3);
      const matrix = Array.from({ length: studentCount }, () => Array.from({ length: studentCount }, () => Math.round(random() * 6) * (100 / 6)));
      const score = (i, j) => matrix[Math.min(i, j)][Math.max(i, j)];
      const rooms = [{ freeSlots: 2, occupants: [] }, { freeSlots: 2, occupants: [] }, { freeSlots: 4, occupants: [] }];
      const exact = optimizeAssignment({ studentCount, rooms, score, strategy: 'exhaustive' });
      const heuristic = optimizeAssignment({ studentCount, rooms, score, strategy: 'local_search' });
      assert.ok(Math.abs(exact.total - heuristic.total) < 1e-6, `trial ${trial}: ${heuristic.total} vs optimum ${exact.total}`);
      assert.equal(arrangementTotal(heuristic.assignment, rooms, score), heuristic.total);
    }
  });

  test('handles a full intake of several hundred students quickly', () => {
    const profiles = Array.from({ length: 400 }, (_, i) => [i % 3, (i >> 1) % 3, (i >> 2) % 3, (i >> 3) % 3]);
    const score = (i, j) => (profiles[i].filter((v, k) => v === profiles[j][k]).length / 4) * 100;
    const rooms = Array.from({ length: 150 }, (_, i) => ({ freeSlots: i % 3 === 0 ? 4 : 2, occupants: [] }));
    const started = Date.now();
    const result = optimizeAssignment({ studentCount: 400, rooms, score });
    assert.equal(result.method, 'local_search');
    assert.equal(result.assignment.length, 400);
    assert.ok(Date.now() - started < 15000, 'optimisation should finish within 15 seconds');
  });
});
