const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*'}));

const db = new Database(process.env.DATABASE_FILE || path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function generateToken(payload){
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/signup', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*_-]).{8,}$/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({ error: 'Weak password' });
  }
  try {
    const password_hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
    const info = stmt.run(username, email, password_hash);
    const token = generateToken({ id: info.lastInsertRowid, username, email });
    return res.status(201).json({ token, user: { id: info.lastInsertRowid, username, email } });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { loginId, password } = req.body || {};
  if (!loginId || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const user = db.prepare('SELECT id, username, email, password_hash FROM users WHERE lower(username)=lower(?) OR lower(email)=lower(?)').get(loginId, loginId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid password' });
  const token = generateToken({ id: user.id, username: user.username, email: user.email });
  return res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

function authMiddleware(req, res, next){
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
