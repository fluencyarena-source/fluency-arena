// announcements.js
const announcementsRouter = require('express').Router();
const supabase = require('../lib/supabase');
const { authMiddleware, adminOnly } = require('../middleware/auth');

announcementsRouter.get('/', async (req, res) => {
  try {
    const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(20);
    res.json({ ok: true, announcements: data || [] });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch announcements' }); }
});

announcementsRouter.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { title, body, type } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const id = 'ann_' + Date.now();
    await supabase.from('announcements').insert({ id, title, body, type: type || 'info', created_by: req.user.id });
    res.status(201).json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to create announcement' }); }
});

announcementsRouter.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await supabase.from('announcements').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete announcement' }); }
});

module.exports = announcementsRouter;
