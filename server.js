require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// ── Security
app.use(helmet());

// ── CORS — credentials:true requires explicit origin, not wildcard
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));

// ── Rate limiting
app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, max: 30, message: { error: 'Too many requests.' } }));
app.use('/api',      rateLimit({ windowMs: 15*60*1000, max: 300 }));

// ── Routes
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/progress',      require('./routes/progress'));
app.use('/api/reviews',       require('./routes/reviews'));
app.use('/api/payments',      require('./routes/payments'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/feedback',      require('./routes/feedback'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/polls',         require('./routes/polls'));

// ── Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  if (err.message === 'Not allowed by CORS') return res.status(403).json({ error: 'CORS: origin not allowed' });
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Fluency Arena API — port ${PORT}`);
  console.log(`   Supabase  : ${process.env.SUPABASE_URL ? '✅' : '❌ missing SUPABASE_URL'}`);
  console.log(`   JWT       : ${process.env.JWT_SECRET ? '✅' : '❌ missing JWT_SECRET'}`);
  console.log(`   Razorpay  : ${process.env.RAZORPAY_KEY_ID?.startsWith('rzp_') ? '✅' : '⚠️  test mode'}`);
  console.log(`   Fast2SMS  : ${process.env.FAST2SMS_API_KEY && !process.env.FAST2SMS_API_KEY.includes('your_') ? '✅' : '⚠️  dev mode (OTP logged to console)'}`);
});
