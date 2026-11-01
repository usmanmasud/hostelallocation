import { config } from '../config.js';
import { transaction } from '../db/connection.js';
import { ROLES } from '../lib/constants.js';
import { DomainError } from '../lib/errors.js';
import { generatePassword, hashPassword, verifyPassword } from '../lib/password.js';
import * as payments from '../repositories/payments.js';
import * as settings from '../repositories/settings.js';
import * as students from '../repositories/students.js';
import * as users from '../repositories/users.js';

// Compared against when the email is unknown, so failed logins take the same time either way.
const DUMMY_HASH = await hashPassword(generatePassword());

/** Creates a student account, its profile and an unpaid payment record for the hostel fee. */
export async function registerStudent({ name, email, password, matricNumber, gender, course, level, phone }) {
  if (users.emailExists(email)) throw new DomainError('An account with this email address already exists.');
  if (students.matricExists(matricNumber)) throw new DomainError('An account with this matric number already exists.');
  const passwordHash = await hashPassword(password);
  return transaction(() => {
    const userId = users.create({ name, email, passwordHash, role: ROLES.STUDENT });
    const studentId = students.create({ userId, matricNumber, gender, course, level, phone });
    payments.createForStudent(studentId, settings.get('hostelFee'));
    return userId;
  });
}

/** Returns the user for valid, active credentials; otherwise throws a DomainError. */
export async function authenticate(email, password) {
  const user = users.findByEmailWithHash(email);
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) throw new DomainError('Incorrect email address or password.');
  if (!user.is_active) throw new DomainError('This account has been deactivated. Please contact the hostel office.');
  users.recordLogin(user.id);
  const { password_hash: _hash, ...publicUser } = user;
  return publicUser;
}

export async function changePassword(userId, currentPassword, newPassword) {
  if (!(await verifyPassword(currentPassword, users.findHashById(userId)))) {
    throw new DomainError('Your current password is incorrect.');
  }
  users.setPasswordHash(userId, await hashPassword(newPassword));
}

export async function createStaffAccount({ name, email, password, role }) {
  if (![ROLES.HOSTEL_ADMIN, ROLES.SYSTEM_ADMIN].includes(role)) throw new DomainError('Choose a staff role.');
  if (users.emailExists(email)) throw new DomainError('An account with this email address already exists.');
  return users.create({ name, email, passwordHash: await hashPassword(password), role });
}

export function updateAccount(userId, { name, email }) {
  const user = users.findById(userId);
  if (!user) throw new DomainError('That user no longer exists.');
  const owner = users.findByEmailWithHash(email);
  if (owner && owner.id !== userId) throw new DomainError('Another account already uses this email address.');
  users.update(userId, { name, email });
}

/** Activates or deactivates an account, never leaving the system without an active System Administrator. */
export function setAccountActive(actorId, userId, isActive) {
  const user = users.findById(userId);
  if (!user) throw new DomainError('That user no longer exists.');
  if (!isActive && user.id === actorId) throw new DomainError('You cannot deactivate your own account.');
  if (!isActive && user.role === ROLES.SYSTEM_ADMIN && users.countActiveByRole(ROLES.SYSTEM_ADMIN) <= 1) {
    throw new DomainError('At least one active System Administrator is required.');
  }
  users.setActive(userId, isActive);
}

/** Sets a new random password for a user and returns it so it can be passed on once. */
export async function resetPassword(userId) {
  if (!users.findById(userId)) throw new DomainError('That user no longer exists.');
  const password = generatePassword();
  users.setPasswordHash(userId, await hashPassword(password));
  return password;
}

/** Creates the first System Administrator when none exists, so a fresh install can be signed into. */
export async function ensureBootstrapAdmin() {
  if (users.countActiveByRole(ROLES.SYSTEM_ADMIN) > 0) return null;
  const email = config.bootstrapAdmin.email.toLowerCase();
  if (users.emailExists(email)) return null;
  const password = config.bootstrapAdmin.password || generatePassword();
  users.create({ name: 'System Administrator', email, passwordHash: await hashPassword(password), role: ROLES.SYSTEM_ADMIN });
  return { email, password, generated: !config.bootstrapAdmin.password };
}
