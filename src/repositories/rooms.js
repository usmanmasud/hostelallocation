import { statement } from '../db/connection.js';
import { nowIso } from '../lib/time.js';

export function list({ hostel, gender } = {}) {
  return statement(
    `SELECT * FROM rooms
      WHERE (:hostel IS NULL OR hostel_name = :hostel)
        AND (:gender IS NULL OR gender = :gender)
      ORDER BY hostel_name, room_number`,
  ).all({ hostel: hostel || null, gender: gender || null });
}

export function findById(id) {
  return statement('SELECT * FROM rooms WHERE id = ?').get(id);
}

export function findByNumber(hostelName, roomNumber) {
  return statement('SELECT * FROM rooms WHERE hostel_name = ? AND room_number = ?').get(hostelName, roomNumber);
}

export function hostelNames() {
  return statement('SELECT DISTINCT hostel_name FROM rooms ORDER BY hostel_name').all().map((row) => row.hostel_name);
}

/** Returns the gender a hostel is reserved for, or undefined for a new hostel name. */
export function hostelGender(hostelName) {
  return statement('SELECT gender FROM rooms WHERE hostel_name = ? LIMIT 1').get(hostelName)?.gender;
}

/** Rooms with at least one free bed for a gender; partially filled rooms first. */
export function listWithSpace(gender) {
  return statement(
    `SELECT * FROM rooms
      WHERE gender = ? AND current_occupancy < capacity
      ORDER BY current_occupancy = 0, hostel_name, room_number`,
  ).all(gender);
}

export function create({ hostelName, roomNumber, gender, capacity }) {
  const result = statement(
    `INSERT INTO rooms (hostel_name, room_number, gender, capacity, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(hostelName, roomNumber, gender, capacity, nowIso());
  return Number(result.lastInsertRowid);
}

export function updateCapacity(id, capacity) {
  statement('UPDATE rooms SET capacity = ? WHERE id = ?').run(capacity, id);
}

export function remove(id) {
  statement('DELETE FROM rooms WHERE id = ?').run(id);
}

export function hasAllocationHistory(id) {
  return Boolean(statement('SELECT 1 FROM allocations WHERE room_id = ? LIMIT 1').get(id));
}

export function adjustOccupancy(id, delta) {
  statement('UPDATE rooms SET current_occupancy = current_occupancy + ? WHERE id = ?').run(delta, id);
}

export function occupancyTotals() {
  return statement(
    `SELECT COUNT(*) AS rooms,
            COALESCE(SUM(capacity), 0) AS beds,
            COALESCE(SUM(current_occupancy), 0) AS occupied_beds,
            COALESCE(SUM(current_occupancy >= capacity), 0) AS full_rooms,
            COALESCE(SUM(current_occupancy = 0), 0) AS empty_rooms,
            COALESCE(SUM(current_occupancy > 0 AND current_occupancy < capacity), 0) AS partial_rooms
       FROM rooms`,
  ).get();
}

export function occupancyByHostel() {
  return statement(
    `SELECT hostel_name, gender,
            COUNT(*) AS rooms,
            SUM(capacity) AS beds,
            SUM(current_occupancy) AS occupied_beds,
            SUM(current_occupancy >= capacity) AS full_rooms
       FROM rooms
      GROUP BY hostel_name, gender
      ORDER BY hostel_name`,
  ).all();
}
