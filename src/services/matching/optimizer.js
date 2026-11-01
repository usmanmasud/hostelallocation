/**
 * Room-arrangement optimiser.
 *
 * Given students who need a room and rooms with free beds (possibly already holding
 * occupants who stay where they are), it chooses the arrangement with the highest total
 * compatibility: the sum of the scores of every pair of students who end up sharing a
 * room (section 3.3.5, Table 3.4). Every student is placed as long as there are beds.
 *
 * Small problems are solved exactly by exhaustive search. Larger ones use a greedy start
 * improved by moves and swaps until no change helps (local search), repeated from several
 * seeded random orders so results are reproducible.
 *
 * People are addressed by index: students are 0..studentCount-1 and existing occupants
 * use the indices after them. `score(i, j)` returns the compatibility of two people.
 */

const EPSILON = 1e-9;
const EXHAUSTIVE_NODE_BUDGET = 250_000;
const MATRIX_LIMIT = 2500;

/**
 * @param {object} problem
 * @param {number} problem.studentCount
 * @param {{ freeSlots: number, occupants: number[] }[]} problem.rooms
 * @param {(i: number, j: number) => number} problem.score
 * @param {number} [problem.seed]
 * @param {'auto' | 'exhaustive' | 'local_search'} [problem.strategy] 'auto' tries exhaustive search first.
 * @returns {{ assignment: number[], total: number, method: 'exhaustive' | 'local_search' | 'none' }}
 *   `assignment[i]` is the index of the room student i is placed in.
 */
export function optimizeAssignment({ studentCount, rooms, score, seed = 1, strategy = 'auto' }) {
  const freeSlots = rooms.reduce((sum, room) => sum + room.freeSlots, 0);
  if (studentCount > freeSlots) {
    throw new RangeError(`Cannot place ${studentCount} students in ${freeSlots} free beds.`);
  }
  if (studentCount === 0) return { assignment: [], total: 0, method: 'none' };

  const peopleCount = studentCount + rooms.reduce((sum, room) => sum + room.occupants.length, 0);
  const pairScore = peopleCount <= MATRIX_LIMIT ? memoise(score, peopleCount) : score;

  if (strategy !== 'local_search') {
    const exact = exhaustiveSearch(studentCount, rooms, pairScore, strategy === 'exhaustive' ? Infinity : EXHAUSTIVE_NODE_BUDGET);
    if (exact) return { ...exact, method: 'exhaustive' };
  }
  return { ...localSearch(studentCount, rooms, pairScore, seed), method: 'local_search' };
}

/** Total compatibility of an arrangement: the sum of all roommate-pair scores. */
export function arrangementTotal(assignment, rooms, score) {
  const members = rooms.map((room) => [...room.occupants]);
  assignment.forEach((roomIndex, student) => members[roomIndex].push(student));
  let total = 0;
  for (const group of members) {
    for (let a = 0; a < group.length; a += 1) {
      for (let b = a + 1; b < group.length; b += 1) total += score(group[a], group[b]);
    }
  }
  return total;
}

function memoise(score, size) {
  const matrix = new Float64Array(size * size).fill(Number.NaN);
  return (i, j) => {
    const index = i * size + j;
    if (Number.isNaN(matrix[index])) {
      matrix[index] = score(i, j);
      matrix[j * size + i] = matrix[index];
    }
    return matrix[index];
  };
}

function gainOfJoining(person, members, score, except = -1) {
  let gain = 0;
  for (const other of members) if (other !== except) gain += score(person, other);
  return gain;
}

/**
 * Tries every distinct arrangement. Empty rooms of the same size are interchangeable, so a
 * student may only open the first untouched one of each size. Returns null if the search
 * would exceed the node budget.
 */
function exhaustiveSearch(studentCount, rooms, score, nodeBudget) {
  const members = rooms.map((room) => [...room.occupants]);
  const free = rooms.map((room) => room.freeSlots);
  const assignment = new Array(studentCount);
  let best = { total: -Infinity, assignment: null };
  let nodes = 0;

  function place(student, runningTotal) {
    nodes += 1;
    if (nodes > nodeBudget) return false;
    if (student === studentCount) {
      if (runningTotal > best.total + EPSILON) best = { total: runningTotal, assignment: assignment.slice() };
      return true;
    }
    const openedEmptySizes = new Set();
    for (let room = 0; room < rooms.length; room += 1) {
      if (free[room] === 0) continue;
      if (members[room].length === 0) {
        if (openedEmptySizes.has(free[room])) continue;
        openedEmptySizes.add(free[room]);
      }
      const gain = gainOfJoining(student, members[room], score);
      members[room].push(student);
      free[room] -= 1;
      assignment[student] = room;
      const completed = place(student + 1, runningTotal + gain);
      members[room].pop();
      free[room] += 1;
      if (!completed) return false;
    }
    return true;
  }

  return place(0, 0) ? best : null;
}

function localSearch(studentCount, rooms, score, seed) {
  const restarts = studentCount <= 50 ? 20 : studentCount <= 200 ? 6 : 2;
  const random = mulberry32(seed);
  let best = null;
  for (let attempt = 0; attempt < restarts; attempt += 1) {
    const order = Array.from({ length: studentCount }, (_, i) => i);
    if (attempt > 0) shuffle(order, random);
    const candidate = improve(greedyStart(order, rooms, score), rooms, score);
    if (!best || candidate.total > best.total + EPSILON) best = candidate;
  }
  return best;
}

/** Places students one by one into the room where they add the most compatibility. */
function greedyStart(order, rooms, score) {
  const members = rooms.map((room) => [...room.occupants]);
  const free = rooms.map((room) => room.freeSlots);
  const assignment = new Array(order.length);
  for (const student of order) {
    let bestRoom = -1;
    let bestGain = -Infinity;
    for (let room = 0; room < rooms.length; room += 1) {
      if (free[room] === 0) continue;
      const gain = gainOfJoining(student, members[room], score);
      if (gain > bestGain + EPSILON) {
        bestGain = gain;
        bestRoom = room;
      }
    }
    members[bestRoom].push(student);
    free[bestRoom] -= 1;
    assignment[student] = bestRoom;
  }
  return assignment;
}

/** Repeatedly applies the best improving move or swap for each student until none remains. */
function improve(assignment, rooms, score) {
  const studentCount = assignment.length;
  const members = rooms.map((room) => [...room.occupants]);
  const free = rooms.map((room) => room.freeSlots);
  assignment.forEach((room, student) => {
    members[room].push(student);
    free[room] -= 1;
  });

  const moveTo = (student, from, to) => {
    members[from].splice(members[from].indexOf(student), 1);
    members[to].push(student);
    free[from] += 1;
    free[to] -= 1;
    assignment[student] = to;
  };

  let improved = true;
  while (improved) {
    improved = false;
    for (let student = 0; student < studentCount; student += 1) {
      const from = assignment[student];
      const stayValue = gainOfJoining(student, members[from], score, student);
      let bestDelta = EPSILON;
      let bestAction = null;

      for (let to = 0; to < rooms.length; to += 1) {
        if (to === from) continue;
        const joinValue = gainOfJoining(student, members[to], score);
        if (free[to] > 0 && joinValue - stayValue > bestDelta) {
          bestDelta = joinValue - stayValue;
          bestAction = { to };
        }
        for (const other of members[to]) {
          if (other >= studentCount) continue; // existing occupants stay put
          const delta =
            joinValue - score(student, other) - stayValue +
            gainOfJoining(other, members[from], score, student) - gainOfJoining(other, members[to], score, other);
          if (delta > bestDelta) {
            bestDelta = delta;
            bestAction = { to, other };
          }
        }
      }

      if (bestAction) {
        moveTo(student, from, bestAction.to);
        if (bestAction.other !== undefined) moveTo(bestAction.other, bestAction.to, from);
        improved = true;
      }
    }
  }
  return { assignment, total: arrangementTotal(assignment, rooms, score) };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
