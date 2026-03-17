const router   = require('express').Router();
const supabase = require('../lib/supabase');
const { authMiddleware, adminOnly } = require('../middleware/auth');

// GET all approved reviews (public)
router.get('/', async (req, res) => {
  try {
    const { data } = await supabase.from('reviews').select('id,name,role_label,rating,review,created_at')
      .order('created_at', { ascending: false }).limit(50);
    res.json({ ok: true, reviews: data || [] });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch reviews' }); }
});

// POST submit review (auth required)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, roleLabel, rating, review } = req.body;
    if (!name || !review || !rating) return res.status(400).json({ error: 'Name, review and rating required' });
    await supabase.from('reviews').insert({
      user_id: req.user.id, name, role_label: roleLabel || '',
      rating: parseInt(rating), review
    });
    res.status(201).json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to submit review' }); }
});

// GET all reviews for admin
router.get('/admin', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { data } = await supabase.from('reviews').select('*').order('created_at', { ascending: false });
    res.json({ ok: true, reviews: data || [] });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch reviews' }); }
});

// DELETE review (admin)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await supabase.from('reviews').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete review' }); }
});

module.exports = router;
