const router   = require('express').Router();
const supabase = require('../lib/supabase');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { type, message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    await supabase.from('feedback').insert({
      user_id: req.user.id, email: req.user.email,
      type: type || 'feedback', message
    });
    res.status(201).json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to submit feedback' }); }
});

router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { data } = await supabase.from('feedback').select('*').order('created_at', { ascending: false });
    res.json({ ok: true, feedback: data || [] });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch feedback' }); }
});

module.exports = router;
