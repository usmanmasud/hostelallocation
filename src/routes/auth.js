import { Router } from 'express';
import { GENDERS, LEVELS } from '../lib/constants.js';
import { DomainError } from '../lib/errors.js';
import { Form } from '../lib/validation.js';
import { HOME_BY_ROLE, redirectIfAuthenticated, signIn } from '../middleware/auth.js';
import { createLoginThrottle } from '../middleware/security.js';
import * as settings from '../repositories/settings.js';
import { authenticate, registerStudent } from '../services/accountService.js';

const router = Router();
const loginThrottle = createLoginThrottle();

router.get('/', (req, res) => {
  res.redirect(req.user ? HOME_BY_ROLE[req.user.role] : '/login');
});

router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('auth/login', { title: 'Sign in', values: {}, errors: {} });
});

router.post('/login', redirectIfAuthenticated, async (req, res) => {
  const form = new Form(req.body).email('email').text('password', { label: 'Password', max: 128 });
  const render = (status, error) =>
    res.status(status).render('auth/login', { title: 'Sign in', values: { email: form.values.email }, errors: form.errors, error });

  if (!form.valid) return render(422);
  const minutesLeft = loginThrottle.isBlocked(req);
  if (minutesLeft) return render(429, `Too many failed attempts. Try again in ${minutesLeft} minute(s).`);

  try {
    const user = await authenticate(form.values.email, req.body.password);
    loginThrottle.reset(req);
    res.redirect(await signIn(req, user));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    loginThrottle.recordFailure(req);
    render(401, error.message);
  }
});

function renderRegister(res, { values = {}, errors = {}, status = 200 } = {}) {
  res.status(status).render('auth/register', {
    title: 'Create student account',
    values,
    errors,
    genders: GENDERS,
    levels: LEVELS,
    courses: settings.get('courses'),
  });
}

router.get('/register', redirectIfAuthenticated, (req, res) => renderRegister(res));

router.post('/register', redirectIfAuthenticated, async (req, res) => {
  const form = new Form(req.body)
    .text('name', { label: 'Full name', min: 3, max: 100 })
    .email('email')
    .text('matricNumber', { label: 'Matric number', min: 4, max: 30 })
    .oneOf('gender', GENDERS, { label: 'Gender' })
    .oneOf('course', settings.get('courses'), { label: 'Course of study' })
    .oneOf('level', LEVELS, { label: 'Level' })
    .text('phone', { label: 'Phone number', required: false, max: 20 })
    .password('password', { confirmField: 'confirmPassword' });
  if (form.values.matricNumber && !/^[A-Za-z0-9/\-]+$/.test(form.values.matricNumber)) {
    form.fail('matricNumber', 'Matric number may only contain letters, numbers, "/" and "-".');
  }
  if (form.values.phone && !/^\+?[0-9 ()-]{7,20}$/.test(form.values.phone)) {
    form.fail('phone', 'Enter a valid phone number.');
  }
  const { password: _password, ...safeValues } = form.values;
  if (!form.valid) return renderRegister(res, { values: safeValues, errors: form.errors, status: 422 });

  try {
    await registerStudent({
      ...form.values,
      matricNumber: form.values.matricNumber.toUpperCase(),
      level: Number(form.values.level),
    });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return renderRegister(res, { values: safeValues, errors: { form: error.message }, status: 409 });
  }
  req.flash('success', 'Your account has been created. Please sign in.');
  res.redirect('/login');
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('hostel.sid');
    res.redirect('/login');
  });
});

export default router;
