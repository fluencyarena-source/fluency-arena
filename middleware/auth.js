const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'administrator') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function teacherOrAdmin(req, res, next) {
  if (!['administrator', 'teacher'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Teacher or admin access required' });
  }
  next();
}

module.exports = { authMiddleware, adminOnly, teacherOrAdmin };
