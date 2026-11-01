import { Router } from 'express';
import { DomainError } from '../lib/errors.js';
import { Form, parseId } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import * as notifications from '../repositories/notifications.js';
import { changePassword } from '../services/accountService.js';

const router = Router();

router.get('/account', requireAuth, (req, res) => {
  res.render('shared/account', { title: 'My account', errors: {} });
});

router.post('/account/password', requireAuth, async (req, res) => {
  const form = new Form(req.body)
    .text('currentPassword', { label: 'Current password', max: 128 })
    .password('newPassword', { label: 'New password', confirmField: 'confirmPassword' });
  if (!form.valid) return res.status(422).render('shared/account', { title: 'My account', errors: form.errors });

  try {
    await changePassword(req.user.id, req.body.currentPassword, form.values.newPassword);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return res.status(422).render('shared/account', { title: 'My account', errors: { currentPassword: error.message } });
  }
  req.flash('success', 'Your password has been changed.');
  res.redirect('/account');
});

router.get('/notifications', requireAuth, (req, res) => {
  res.render('shared/notifications', { title: 'Notifications', items: notifications.listForUser(req.user.id) });
});

router.post('/notifications/read-all', requireAuth, (req, res) => {
  notifications.markAllRead(req.user.id);
  res.redirect('/notifications');
});

/** Marks a notification read and follows its link (only ever a local path). */
router.post('/notifications/:id/open', requireAuth, (req, res) => {
  const item = notifications.markRead(parseId(req.params.id), req.user.id);
  const link = item?.link?.startsWith('/') && !item.link.startsWith('//') ? item.link : '/notifications';
  res.redirect(link);
});

export default router;
