const router   = require('express').Router();
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

// ── GET /api/progress
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('progress').select('*').eq('user_id', req.user.id).maybeSingle();
    if (error) throw error;
    res.json({ ok: true, progress: data || {} });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch progress.' });
  }
});

// ── PUT /api/progress
router.put('/', authMiddleware, async (req, res) => {
  try {
    const { xp, words, streak, done_vocab, done_wotd, done_speaking, speaking_scores } = req.body;
    const { error } = await supabase.from('progress').upsert({
      user_id:        req.user.id,
      xp:             xp             || 0,
      words:          words          || 0,
      streak:         streak         || 0,
      done_vocab:     done_vocab     || [],
      done_wotd:      done_wotd      || [],
      done_speaking:  done_speaking  || [],
      speaking_scores: speaking_scores || [],
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Progress save error:', err);
    res.status(500).json({ error: 'Failed to save progress.' });
  }
});

// ── DELETE /api/progress/speaking  (clear speaking history)
router.delete('/speaking', authMiddleware, async (req, res) => {
  try {
    await supabase.from('progress')
      .update({ speaking_scores: [] })
      .eq('user_id', req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear speaking history.' });
  }
});

module.exports = router;
