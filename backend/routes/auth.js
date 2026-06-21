const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'customer-mgmt-secret-key-2024';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

router.post('/signup', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (username === 'gowricharan') {
      return res.status(400).json({ error: 'This username is reserved' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    const existingPending = db.prepare('SELECT id FROM pending_signups WHERE username = ?').get(username);
    if (existingUser || existingPending) {
      return res.status(400).json({ error: 'Username already exists or is pending approval' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO pending_signups (username, password) VALUES (?, ?)').run(username, hashedPassword);

    res.json({ message: 'Account created! Please wait for admin approval.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!user.approved) {
      return res.status(403).json({ error: 'Account pending approval. Please wait for admin confirmation.', pending: true });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        username: user.username,
        role: user.role,
        dataEntryAccess: !!user.dataEntryAccess,
        excelAccess: !!user.excelAccess,
        auditAccess: !!user.auditAccess,
        analyticsAccess: !!user.analyticsAccess
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/forgot-password', (req, res) => {
  try {
    const { username, newPassword } = req.body;
    if (!username || !newPassword) {
      return res.status(400).json({ error: 'Username and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (username === 'gowricharan') {
      return res.status(400).json({ error: 'Cannot reset password for admin account' });
    }

    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    const pending = db.prepare('SELECT id FROM pending_signups WHERE username = ?').get(username);
    if (!user && !pending) {
      return res.status(404).json({ error: 'Username not found' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare('INSERT INTO password_reset_requests (username, newPassword) VALUES (?, ?)').run(username, hashedPassword);

    res.json({ message: 'Password reset request submitted. Wait for admin approval.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', authenticateToken, adminOnly, (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, role, approved, dataEntryAccess, excelAccess, auditAccess, analyticsAccess, createdAt FROM users').all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pending-signups', authenticateToken, adminOnly, (req, res) => {
  try {
    const pending = db.prepare('SELECT * FROM pending_signups').all();
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/password-reset-requests', authenticateToken, adminOnly, (req, res) => {
  try {
    const requests = db.prepare("SELECT * FROM password_reset_requests WHERE status = 'pending'").all();
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/approve-pending-user', authenticateToken, adminOnly, (req, res) => {
  try {
    const { username, dataEntryAccess, excelAccess, auditAccess, analyticsAccess } = req.body;
    const pending = db.prepare('SELECT * FROM pending_signups WHERE username = ?').get(username);
    if (!pending) return res.status(404).json({ error: 'Pending signup not found' });

    db.prepare(`INSERT INTO users (username, password, role, approved, dataEntryAccess, excelAccess, auditAccess, analyticsAccess)
      VALUES (?, ?, 'user', 1, ?, ?, ?, ?)`).run(
      pending.username, pending.password,
      dataEntryAccess ? 1 : 0, excelAccess ? 1 : 0, auditAccess ? 1 : 0, analyticsAccess ? 1 : 0
    );
    db.prepare('DELETE FROM pending_signups WHERE username = ?').run(username);

    res.json({ message: `User ${username} approved!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reject-pending-user', authenticateToken, adminOnly, (req, res) => {
  try {
    const { username } = req.body;
    db.prepare('DELETE FROM pending_signups WHERE username = ?').run(username);
    res.json({ message: `User ${username} rejected.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/approve-password-reset', authenticateToken, adminOnly, (req, res) => {
  try {
    const { username } = req.body;
    const request = db.prepare("SELECT * FROM password_reset_requests WHERE username = ? AND status = 'pending'").get(username);
    if (!request) return res.status(404).json({ error: 'Password reset request not found' });

    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (user) {
      db.prepare('UPDATE users SET password = ?, updatedAt = datetime(\'now\') WHERE username = ?').run(request.newPassword, username);
    }
    const pending = db.prepare('SELECT id FROM pending_signups WHERE username = ?').get(username);
    if (pending) {
      db.prepare('UPDATE pending_signups SET password = ? WHERE username = ?').run(request.newPassword, username);
    }

    db.prepare("UPDATE password_reset_requests SET status = 'approved' WHERE username = ?").run(username);
    res.json({ message: `Password reset approved for ${username}!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reject-password-reset', authenticateToken, adminOnly, (req, res) => {
  try {
    const { username } = req.body;
    db.prepare("UPDATE password_reset_requests SET status = 'rejected' WHERE username = ?").run(username);
    res.json({ message: `Password reset rejected for ${username}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/toggle-access', authenticateToken, adminOnly, (req, res) => {
  try {
    const { username, accessType } = req.body;
    const validTypes = ['dataEntryAccess', 'excelAccess', 'auditAccess', 'analyticsAccess'];
    if (!validTypes.includes(accessType)) {
      return res.status(400).json({ error: 'Invalid access type' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const currentValue = user[accessType];
    db.prepare(`UPDATE users SET ${accessType} = ?, updatedAt = datetime('now') WHERE username = ?`).run(currentValue ? 0 : 1, username);

    res.json({ message: `${accessType} toggled for ${username}`, newValue: currentValue ? 0 : 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/delete-user/:username', authenticateToken, adminOnly, (req, res) => {
  try {
    const { username } = req.params;
    if (username === 'gowricharan') {
      return res.status(400).json({ error: 'Cannot delete master admin account' });
    }
    db.prepare('DELETE FROM users WHERE username = ?').run(username);
    res.json({ message: `User ${username} deleted.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, username, role, approved, dataEntryAccess, excelAccess, auditAccess, analyticsAccess FROM users WHERE username = ?').get(req.user.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    username: user.username,
    role: user.role,
    dataEntryAccess: !!user.dataEntryAccess,
    excelAccess: !!user.excelAccess,
    auditAccess: !!user.auditAccess,
    analyticsAccess: !!user.analyticsAccess
  });
});

module.exports = router;
module.exports.authenticateToken = authenticateToken;
module.exports.adminOnly = adminOnly;
