const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const supabase = require('../lib/supabase');
const { authMiddleware, adminOnly } = require('../middleware/auth');

function safeUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

// ── GET /api/users/profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users').select('*').eq('id', req.user.id).single();
    if (error || !user) return res.status(404).json({ error: 'User not found.' });
    res.json({ ok: true, user: safeUser(user) });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch profile.' }); }
});

// ── PUT /api/users/profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { firstName, lastName, dob, stream, preparing, bio } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ error: 'Name is required.' });

    await supabase.from('users').update({
      first_name: firstName.trim(),
      last_name:  lastName.trim(),
      dob:        dob   || null,
      stream:     stream || null,
      preparing:  preparing || [],
      bio:        bio   || ''
    }).eq('id', req.user.id);

    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    res.json({ ok: true, user: safeUser(user) });
  } catch (err) { res.status(500).json({ error: 'Failed to update profile.' }); }
});

// ── PUT /api/users/account
router.put('/account', authMiddleware, async (req, res) => {
  try {
    const { firstName, lastName, email, mobile, privacy } = req.body;
    const updates = {};

    if (firstName) updates.first_name = firstName.trim();
    if (lastName)  updates.last_name  = lastName.trim();
    if (mobile)    updates.mobile     = mobile.replace(/\s+/g, '').trim();
    if (privacy)   updates.privacy    = privacy;

    // Only update email if changed
    if (email && email.toLowerCase().trim() !== req.user.email) {
      const cleanEmail = email.toLowerCase().trim();
      const { data: existing } = await supabase
        .from('users').select('id').eq('email', cleanEmail).maybeSingle();
      if (existing) return res.status(409).json({ error: 'Email already in use.' });
      updates.email = cleanEmail;
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('users').update(updates).eq('id', req.user.id);
    }

    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    res.json({ ok: true, user: safeUser(user) });
  } catch (err) {
    console.error('Account update error:', err);
    res.status(500).json({ error: 'Failed to update account.' });
  }
});

// ── PUT /api/users/password
router.put('/password', authMiddleware, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const hash = await bcrypt.hash(newPassword, 10);
    await supabase.from('users').update({ password_hash: hash }).eq('id', req.user.id);
    res.json({ ok: true, message: 'Password updated successfully.' });
  } catch (err) { res.status(500).json({ error: 'Failed to update password.' }); }
});

// ── PUT /api/users/notifications
router.put('/notifications', authMiddleware, async (req, res) => {
  try {
    await supabase.from('users')
      .update({ notification_prefs: req.body })
      .eq('id', req.user.id);
    res.json({ ok: true, message: 'Notification preferences saved.' });
  } catch (err) { res.status(500).json({ error: 'Failed to save preferences.' }); }
});

// ── POST /api/users/subscribe
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!['pro', 'champion'].includes(plan))
      return res.status(400).json({ error: 'Invalid plan. Must be pro or champion.' });
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('users').update({ plan, plan_expiry: expiry }).eq('id', req.user.id);
    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    res.json({ ok: true, user: safeUser(user) });
  } catch (err) { res.status(500).json({ error: 'Failed to subscribe.' }); }
});

// ── POST /api/users/unsubscribe
router.post('/unsubscribe', authMiddleware, async (req, res) => {
  try {
    await supabase.from('users').update({ plan: 'free', plan_expiry: null }).eq('id', req.user.id);
    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    res.json({ ok: true, user: safeUser(user) });
  } catch (err) { res.status(500).json({ error: 'Failed to cancel subscription.' }); }
});

// ══════════════════════ ADMIN ROUTES ══════════════════════

// ── GET /api/users  (admin — all users)
router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, users: users.map(safeUser) });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch users.' }); }
});

// ── PUT /api/users/:id/role  (admin)
router.put('/:id/role', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['student', 'teacher', 'administrator'];
    if (!validRoles.includes(role))
      return res.status(400).json({ error: 'Invalid role.' });

    const { data: target } = await supabase.from('users').select('email').eq('id', req.params.id).single();
    if (target?.email === process.env.ADMIN_EMAIL)
      return res.status(403).json({ error: 'Cannot change role of protected admin account.' });

    await supabase.from('users').update({ role }).eq('id', req.params.id);
    await supabase.from('admin_logs').insert({ message: `Role of user ${req.params.id} changed to ${role}`, admin_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to update role.' }); }
});

// ── PUT /api/users/:id/plan  (admin)
router.put('/:id/plan', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { plan } = req.body;
    const expiry = (plan && plan !== 'free')
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    await supabase.from('users').update({ plan: plan || 'free', plan_expiry: expiry }).eq('id', req.params.id);
    await supabase.from('admin_logs').insert({ message: `Plan of user ${req.params.id} changed to ${plan}`, admin_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to update plan.' }); }
});

// ── DELETE /api/users/:id  (admin)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: target } = await supabase.from('users').select('email').eq('id', id).single();
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.email === process.env.ADMIN_EMAIL)
      return res.status(403).json({ error: 'Cannot delete the protected admin account.' });

    // Delete related data
    await supabase.from('progress').delete().eq('user_id', id);

    // Delete user
    await supabase.from('users').delete().eq('id', id);
    await supabase.from('admin_logs').insert({ message: `User ${id} (${target.email}) permanently deleted`, admin_id: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

module.exports = router;
