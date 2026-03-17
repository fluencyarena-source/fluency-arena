const router   = require('express').Router();
const supabase = require('../lib/supabase');
const { authMiddleware, adminOnly } = require('../middleware/auth');

// ── GET /api/admin/stats
router.get('/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    // Run all count queries in parallel
    const [
      usersRes,
      proRes,
      champRes,
      paymentsCountRes,
      paymentsAmountRes
    ] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('plan', 'pro'),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('plan', 'champion'),
      supabase.from('payments').select('id', { count: 'exact', head: true }),
      supabase.from('payments').select('amount')
    ]);

    const revenue = (paymentsAmountRes.data || []).reduce((a, p) => a + (p.amount || 0), 0);

    res.json({
      ok: true,
      stats: {
        totalUsers:    usersRes.count    || 0,
        proUsers:      proRes.count      || 0,
        champUsers:    champRes.count    || 0,
        totalPayments: paymentsCountRes.count || 0,
        revenue
      }
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ── GET /api/admin/signup-logs
router.get('/signup-logs', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('signup_logs').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    res.json({ ok: true, logs: data || [] });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch signup logs.' }); }
});

// ── DELETE /api/admin/signup-logs  (clear all)
router.delete('/signup-logs', authMiddleware, adminOnly, async (req, res) => {
  try {
    await supabase.from('signup_logs').delete().neq('id', 0);
    await supabase.from('admin_logs').insert({ message: 'Signup logs cleared', admin_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to clear signup logs.' }); }
});

// ── GET /api/admin/logs
router.get('/logs', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('admin_logs').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    res.json({ ok: true, logs: data || [] });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch logs.' }); }
});

// ── POST /api/admin/log
router.post('/log', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required.' });
    await supabase.from('admin_logs').insert({ message, admin_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to write log.' }); }
});

// ── POST /api/admin/expire-subscriptions
// Should be called by a cron job daily (e.g. Railway cron or Supabase scheduled function)
router.post('/expire-subscriptions', authMiddleware, adminOnly, async (req, res) => {
  try {
    const now = new Date().toISOString();

    // Expire plans
    const { data: expired } = await supabase
      .from('users')
      .select('id')
      .neq('plan', 'free')
      .not('plan_expiry', 'is', null)
      .lt('plan_expiry', now);

    if (expired && expired.length > 0) {
      const ids = expired.map(u => u.id);
      await supabase.from('users').update({ plan: 'free', plan_expiry: null }).in('id', ids);
    }

    // Permanently delete accounts past their 7-day grace period
    const { data: toDelete } = await supabase
      .from('users')
      .select('id, email')
      .not('deletion_scheduled_at', 'is', null)
      .lt('deletion_scheduled_at', now);

    if (toDelete && toDelete.length > 0) {
      const ids = toDelete.map(u => u.id);
      await supabase.from('progress').delete().in('user_id', ids);
      await supabase.from('users').delete().in('id', ids);
      await supabase.from('admin_logs').insert({
        message: `Auto-deleted ${toDelete.length} account(s): ${toDelete.map(u => u.email).join(', ')}`,
        admin_id: req.user.id
      });
    }

    res.json({
      ok: true,
      expired: expired?.length || 0,
      deleted: toDelete?.length || 0
    });
  } catch (err) {
    console.error('Expire subscriptions error:', err);
    res.status(500).json({ error: 'Failed to run expiry job.' });
  }
});

module.exports = router;
