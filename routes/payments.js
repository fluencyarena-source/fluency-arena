const router   = require('express').Router();
const crypto   = require('crypto');
const supabase = require('../lib/supabase');
const { authMiddleware, adminOnly } = require('../middleware/auth');

// Plan amounts in paise (₹1 = 100 paise)
const PLAN_AMOUNTS = {
  pro:      29900,  // ₹299
  champion: 49900   // ₹499
};

function getRazorpay() {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || keyId.includes('your_key') || keyId === 'rzp_test_YOUR_KEY_HERE') return null;
  const Razorpay = require('razorpay');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// ── POST /api/payments/create-order
router.post('/create-order', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLAN_AMOUNTS[plan])
      return res.status(400).json({ error: 'Invalid plan. Must be pro or champion.' });

    const rzp = getRazorpay();

    if (!rzp) {
      // Test mode — return a mock order so frontend can still test UI
      return res.json({
        ok: true,
        testMode: true,
        order: {
          id: 'order_test_' + Date.now(),
          amount: PLAN_AMOUNTS[plan],
          currency: 'INR'
        },
        key: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder'
      });
    }

    const order = await rzp.orders.create({
      amount:   PLAN_AMOUNTS[plan],
      currency: 'INR',
      notes:    { plan, userId: req.user.id }
    });

    res.json({ ok: true, order, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Failed to create payment order.' });
  }
});

// ── POST /api/payments/verify
router.post('/verify', authMiddleware, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;

    if (!plan || !PLAN_AMOUNTS[plan])
      return res.status(400).json({ error: 'Invalid plan.' });

    // Verify Razorpay signature
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const isTestOrder = razorpay_order_id?.startsWith('order_test_');

    if (secret && !secret.includes('your_key') && !isTestOrder) {
      const body        = razorpay_order_id + '|' + razorpay_payment_id;
      const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
      if (expectedSig !== razorpay_signature) {
        return res.status(400).json({ error: 'Payment signature verification failed.' });
      }
    }

    // Activate plan — 30 days from now
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('users').update({ plan, plan_expiry: expiry }).eq('id', req.user.id);

    // Record payment
    await supabase.from('payments').insert({
      user_id:             req.user.id,
      razorpay_payment_id: razorpay_payment_id || 'test_' + Date.now(),
      razorpay_order_id,
      plan,
      amount: PLAN_AMOUNTS[plan] / 100,
      status: 'captured'
    });

    await supabase.from('admin_logs').insert({
      message: `Payment received: user ${req.user.id} subscribed to ${plan} (₹${PLAN_AMOUNTS[plan]/100})`,
      admin_id: null
    });

    // Return updated user
    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    const { password_hash, ...safeUser } = user;
    res.json({ ok: true, user: safeUser });
  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ error: 'Payment verification failed.' });
  }
});

// ── GET /api/payments  (admin only)
router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('*, users(email, first_name, last_name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, payments: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payments.' });
  }
});

module.exports = router;
