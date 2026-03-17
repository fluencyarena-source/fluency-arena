const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

// ── Helpers
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, plan: user.plan },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}
function safeUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}
function genId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

// ── POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, mobile, password } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !mobile || !password)
      return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Please enter a valid email address.' });

    const cleanEmail  = email.toLowerCase().trim();
    const cleanMobile = mobile.replace(/\s+/g, '').trim();

    // Check email uniqueness — use maybeSingle to avoid throwing on no-match
    const { data: emailExists } = await supabase
      .from('users').select('id').eq('email', cleanEmail).maybeSingle();
    if (emailExists) return res.status(409).json({ error: 'This email is already registered. Please log in.' });

    // Check mobile uniqueness
    const { data: mobileExists } = await supabase
      .from('users').select('id').eq('mobile', cleanMobile).maybeSingle();
    if (mobileExists) return res.status(409).json({ error: 'This mobile number is already linked to an account.' });

    // Hash password
    const hash = await bcrypt.hash(password, 10);
    const id   = genId('user');

    // Insert user
    const { data: user, error: insertErr } = await supabase
      .from('users').insert({
        id,
        first_name: firstName.trim(),
        last_name:  lastName.trim(),
        email:      cleanEmail,
        mobile:     cleanMobile,
        password_hash: hash,
        role: 'student',
        plan: 'free',
        profile_complete: false,
        last_login: new Date().toISOString(),
        created_at: new Date().toISOString()
      }).select().single();

    if (insertErr) {
      console.error('Insert error:', insertErr);
      throw insertErr;
    }

    // Signup log
    await supabase.from('signup_logs').insert({
      user_id: id,
      email: cleanEmail,
      name: firstName.trim() + ' ' + lastName.trim(),
      mobile: cleanMobile
    });

    // Seed progress row
    await supabase.from('progress').insert({ user_id: id });

    const token = signToken(user);
    res.status(201).json({ ok: true, token, user: safeUser(user) });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

// ── POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const { data: user, error } = await supabase
      .from('users').select('*').eq('email', email.toLowerCase().trim()).maybeSingle();

    if (error || !user)
      return res.status(401).json({ error: 'Incorrect email or password.' });

    // Check if account is pending deletion — cancel it on login
    if (user.deletion_scheduled_at) {
      const deleteAt = new Date(user.deletion_scheduled_at);
      if (deleteAt <= new Date()) {
        // Grace period over — hard delete
        await supabase.from('users').delete().eq('id', user.id);
        return res.status(401).json({ error: 'This account has been permanently deleted.' });
      }
      // Still in grace period — cancel deletion
      await supabase.from('users').update({ deletion_scheduled_at: null }).eq('id', user.id);
    }

    // Verify password
    const match = await bcrypt.compare(password, user.password_hash || '');
    if (!match)
      return res.status(401).json({ error: 'Incorrect email or password.' });

    // Update last login
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

    const token = signToken(user);
    const userObj = safeUser(user);
    if (user.deletion_scheduled_at) userObj.deletionCancelled = true;

    res.json({ ok: true, token, user: userObj });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Google credential required.' });

    if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID.includes('your_'))
      return res.status(400).json({ error: 'Google Sign-In is not configured on this server.' });

    const { OAuth2Client } = require('google-auth-library');
    const client  = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket  = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, given_name, family_name } = payload;

    if (!email) return res.status(400).json({ error: 'Could not read email from Google account.' });

    const cleanEmail = email.toLowerCase().trim();

    // Find existing user
    let { data: user } = await supabase
      .from('users').select('*').eq('email', cleanEmail).maybeSingle();

    if (!user) {
      // Create new user
      const id = genId('user_g');
      const { data: newUser, error } = await supabase.from('users').insert({
        id,
        first_name: given_name || cleanEmail.split('@')[0],
        last_name:  family_name || '',
        email:      cleanEmail,
        google_id:  googleId,
        role: 'student', plan: 'free',
        profile_complete: false,
        last_login: new Date().toISOString(),
        created_at: new Date().toISOString()
      }).select().single();
      if (error) throw error;

      await supabase.from('progress').insert({ user_id: id });
      await supabase.from('signup_logs').insert({
        user_id: id, email: cleanEmail,
        name: (given_name || '') + ' ' + (family_name || '')
      });
      user = newUser;
    } else {
      // Update google_id and last login
      await supabase.from('users')
        .update({ google_id: googleId, last_login: new Date().toISOString() })
        .eq('id', user.id);
    }

    const token = signToken(user);
    res.json({ ok: true, token, user: safeUser(user) });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Google sign-in failed.' });
  }
});

// ── POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ error: 'Mobile number required.' });

    const otp     = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Upsert OTP record
    const { error } = await supabase.from('otp_store')
      .upsert({ mobile, otp, expires_at: expires }, { onConflict: 'mobile' });
    if (error) throw error;

    // Send SMS via Fast2SMS
    if (process.env.FAST2SMS_API_KEY && !process.env.FAST2SMS_API_KEY.includes('your_')) {
      const smsRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: { authorization: process.env.FAST2SMS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          route: 'otp',
          variables_values: otp,
          numbers: mobile.replace(/^\+91/, '').replace(/\D/g, '')
        })
      });
      const result = await smsRes.json();
      if (!result.return) {
        console.error('Fast2SMS error:', result);
        throw new Error('SMS delivery failed');
      }
    } else {
      // Dev mode — print OTP to console
      console.log(`[DEV OTP] ${mobile} → ${otp}`);
    }

    res.json({ ok: true, message: 'OTP sent successfully.' });
  } catch (err) {
    console.error('OTP send error:', err);
    res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
});

// ── POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (!mobile || !otp) return res.status(400).json({ error: 'Mobile and OTP are required.' });

    const { data: record } = await supabase
      .from('otp_store').select('*').eq('mobile', mobile).maybeSingle();

    if (!record)
      return res.status(400).json({ error: 'OTP not found. Please request a new one.' });
    if (new Date(record.expires_at) < new Date())
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    if (record.otp !== otp.toString())
      return res.status(400).json({ error: 'Invalid OTP. Please check and try again.' });

    // Delete used OTP
    await supabase.from('otp_store').delete().eq('mobile', mobile);
    res.json({ ok: true, verified: true });
  } catch (err) {
    console.error('OTP verify error:', err);
    res.status(500).json({ error: 'OTP verification failed.' });
  }
});

// ── GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users').select('*').eq('id', req.user.id).maybeSingle();
    if (error || !user) return res.status(404).json({ error: 'User not found.' });
    res.json({ ok: true, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user.' });
  }
});

// ── POST /api/auth/complete-profile
router.post('/complete-profile', authMiddleware, async (req, res) => {
  try {
    const { dob, stream, preparing } = req.body;
    if (!dob || !stream)
      return res.status(400).json({ error: 'Date of birth and stream are required.' });

    await supabase.from('users').update({
      dob,
      stream,
      preparing: preparing || [],
      profile_complete: true
    }).eq('id', req.user.id);

    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    const token = signToken(user);
    res.json({ ok: true, token, user: safeUser(user) });
  } catch (err) {
    console.error('Complete profile error:', err);
    res.status(500).json({ error: 'Failed to complete profile.' });
  }
});

// ── POST /api/auth/delete-account  (schedule 7-day deletion)
router.post('/delete-account', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body;

    const { data: user } = await supabase
      .from('users').select('*').eq('id', req.user.id).single();
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Protect admin account
    if (user.email === process.env.ADMIN_EMAIL)
      return res.status(403).json({ error: 'Cannot delete the protected admin account.' });

    // Verify password (skip for Google-only accounts)
    if (user.password_hash) {
      if (!password) return res.status(400).json({ error: 'Password is required to delete account.' });
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.status(401).json({ error: 'Incorrect password.' });
    }

    const deleteAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await supabase.from('users')
      .update({ deletion_scheduled_at: deleteAt.toISOString() })
      .eq('id', req.user.id);

    res.json({ ok: true, deleteAt: deleteAt.toISOString() });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Failed to schedule deletion.' });
  }
});

module.exports = router;
