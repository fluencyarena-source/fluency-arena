const router   = require('express').Router();
const supabase = require('../lib/supabase');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const { data } = await supabase.from('debate_polls').select('*').order('created_at', { ascending: false });
    res.json({ ok: true, polls: data || [] });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch polls' }); }
});

router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { question, options, closesAt } = req.body;
    if (!question) return res.status(400).json({ error: 'Question required' });
    const id = 'poll_' + Date.now();
    await supabase.from('debate_polls').insert({
      id, question, options: JSON.stringify(options || []),
      votes: '{}', closes_at: closesAt || null
    });
    res.status(201).json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to create poll' }); }
});

router.post('/:id/vote', authMiddleware, async (req, res) => {
  try {
    const { option } = req.body;
    const { data: poll } = await supabase.from('debate_polls').select('votes').eq('id', req.params.id).single();
    if (!poll) return res.status(404).json({ error: 'Poll not found' });
    const votes = typeof poll.votes === 'string' ? JSON.parse(poll.votes) : poll.votes;
    votes[req.user.id] = option;
    await supabase.from('debate_polls').update({ votes: JSON.stringify(votes) }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to vote' }); }
});

module.exports = router;
