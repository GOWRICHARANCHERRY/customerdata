const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (user.role !== 'admin') {
      const result = await db.query('SELECT "loginFrom", "loginTo", timezone FROM users WHERE username = $1', [user.username]);
      if (result.rows.length > 0) {
        const { loginFrom, loginTo, timezone } = result.rows[0];
        if (loginFrom && loginTo) {
          const currentTime = getCurrentTimeInTimezone(timezone || 'UTC');
          if (currentTime < loginFrom || currentTime > loginTo) {
            return res.status(403).json({
              error: 'Session expired due to login time restriction.',
              timeRestricted: true
            });
          }
        }
      }
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

function requirePermission(permission) {
  return async (req, res, next) => {
    if (req.user.role === 'admin') return next();
    try {
      const result = await db.query('SELECT "' + permission + '" FROM users WHERE username = $1', [req.user.username]);
      if (result.rows.length === 0 || !result.rows[0][permission]) {
        return res.status(403).json({ error: 'Access denied: ' + permission + ' required' });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

function getCurrentTimeInTimezone(timezone) {
  const now = new Date();
  const parts = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone || 'UTC' }).split(':');
  return parts[0] + ':' + parts[1];
}

router.post('/signup', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (!USERNAME_REGEX.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-30 alphanumeric characters or underscores' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and a number' });
    }

    if (username.toLowerCase() === 'gowricharan') {
      return res.status(400).json({ error: 'This username is reserved' });
    }

    const existingUser = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const existingPending = await db.query('SELECT id FROM pending_signups WHERE LOWER(username) = LOWER($1)', [username]);
    if (existingUser.rows.length > 0 || existingPending.rows.length > 0) {
      return res.json({ message: 'If the username is available, your account has been created.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    await db.query('INSERT INTO pending_signups (username, password) VALUES ($1, $2)', [username, hashedPassword]);

    res.json({ message: 'If the username is available, your account has been created.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await db.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!user.approved) {
      return res.status(403).json({ error: 'Account pending approval. Please wait for admin confirmation.', pending: true });
    }

    if (username.toLowerCase() !== 'gowricharan' && user.loginFrom && user.loginTo) {
      const currentTime = getCurrentTimeInTimezone(user.timezone || 'UTC');
      if (currentTime < user.loginFrom || currentTime > user.loginTo) {
        return res.status(403).json({
          error: `Login restricted. Your allowed login time is ${user.loginFrom} to ${user.loginTo}.`,
          timeRestricted: true,
          loginFrom: user.loginFrom,
          loginTo: user.loginTo
        });
      }
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { username, newPassword } = req.body;
    if (!username || !newPassword) {
      return res.status(400).json({ error: 'Username and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and a number' });
    }

    if (username.toLowerCase() === 'gowricharan') {
      return res.status(400).json({ error: 'Cannot reset password for admin account' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await db.query('INSERT INTO password_reset_requests (username, "newPassword") VALUES ($1, $2)', [username, hashedPassword]);

    res.json({ message: 'If the username exists, a reset request has been submitted.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/users', authenticateToken, adminOnly, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, role, approved, "dataEntryAccess", "excelAccess", "auditAccess", "analyticsAccess", "loginFrom", "loginTo", timezone, "createdAt" FROM users ORDER BY username');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/pending-signups', authenticateToken, adminOnly, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, timestamp FROM pending_signups');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/password-reset-requests', authenticateToken, adminOnly, async (req, res) => {
  try {
    const result = await db.query("SELECT id, username, timestamp, status FROM password_reset_requests WHERE status = 'pending'");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/approve-pending-user', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { username, dataEntryAccess, excelAccess, auditAccess, analyticsAccess } = req.body;
    const pendingResult = await db.query('SELECT * FROM pending_signups WHERE username = $1', [username]);
    const pending = pendingResult.rows[0];
    if (!pending) return res.status(404).json({ error: 'Pending signup not found' });

    await db.query(
      `INSERT INTO users (username, password, role, approved, "dataEntryAccess", "excelAccess", "auditAccess", "analyticsAccess")
       VALUES ($1, $2, 'user', 1, $3, $4, $5, $6)`,
      [pending.username, pending.password, dataEntryAccess ? 1 : 0, excelAccess ? 1 : 0, auditAccess ? 1 : 0, analyticsAccess ? 1 : 0]
    );
    await db.query('DELETE FROM pending_signups WHERE username = $1', [username]);

    res.json({ message: `User ${username} approved!` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reject-pending-user', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { username } = req.body;
    await db.query('DELETE FROM pending_signups WHERE username = $1', [username]);
    res.json({ message: `User ${username} rejected.` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/approve-password-reset', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { username } = req.body;
    const reqResult = await db.query("SELECT * FROM password_reset_requests WHERE username = $1 AND status = 'pending'", [username]);
    const request = reqResult.rows[0];
    if (!request) return res.status(404).json({ error: 'Password reset request not found' });

    const userResult = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rows.length > 0) {
      await db.query('UPDATE users SET password = $1, "updatedAt" = NOW() WHERE username = $2', [request.newPassword, username]);
    }
    const pendingResult = await db.query('SELECT id FROM pending_signups WHERE username = $1', [username]);
    if (pendingResult.rows.length > 0) {
      await db.query('UPDATE pending_signups SET password = $1 WHERE username = $2', [request.newPassword, username]);
    }

    await db.query("UPDATE password_reset_requests SET status = 'approved' WHERE username = $1", [username]);
    res.json({ message: `Password reset approved for ${username}!` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reject-password-reset', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { username } = req.body;
    await db.query("UPDATE password_reset_requests SET status = 'rejected' WHERE username = $1", [username]);
    res.json({ message: `Password reset rejected for ${username}.` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/toggle-access', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { username, accessType } = req.body;
    const validTypes = ['dataEntryAccess', 'excelAccess', 'auditAccess', 'analyticsAccess'];
    if (!validTypes.includes(accessType)) {
      return res.status(400).json({ error: 'Invalid access type' });
    }

    const userResult = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const currentValue = user[accessType];
    await db.query(
      `UPDATE users SET "${accessType}" = $1, "updatedAt" = NOW() WHERE username = $2`,
      [currentValue ? 0 : 1, username]
    );

    res.json({ message: `${accessType} toggled for ${username}`, newValue: currentValue ? 0 : 1 });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/update-login-time', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { username, loginFrom, loginTo, timezone } = req.body;
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (loginFrom && !timeRegex.test(loginFrom)) {
      return res.status(400).json({ error: 'loginFrom must be in HH:MM format' });
    }
    if (loginTo && !timeRegex.test(loginTo)) {
      return res.status(400).json({ error: 'loginTo must be in HH:MM format' });
    }

    const userResult = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    if (!userResult.rows[0]) return res.status(404).json({ error: 'User not found' });

    await db.query(
      `UPDATE users SET "loginFrom" = $1, "loginTo" = $2, timezone = $3, "updatedAt" = NOW() WHERE username = $4`,
      [loginFrom || null, loginTo || null, timezone || 'UTC', username]
    );

    res.json({ message: `Login time updated for ${username}` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/delete-user/:username', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { username } = req.params;
    if (username.toLowerCase() === 'gowricharan') {
      return res.status(400).json({ error: 'Cannot delete master admin account' });
    }
    await db.query('DELETE FROM users WHERE username = $1', [username]);
    res.json({ message: `User ${username} deleted.` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, role, approved, "dataEntryAccess", "excelAccess", "auditAccess", "analyticsAccess" FROM users WHERE username = $1', [req.user.username]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      username: user.username,
      role: user.role,
      dataEntryAccess: !!user.dataEntryAccess,
      excelAccess: !!user.excelAccess,
      auditAccess: !!user.auditAccess,
      analyticsAccess: !!user.analyticsAccess
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.authenticateToken = authenticateToken;
module.exports.adminOnly = adminOnly;
module.exports.requirePermission = requirePermission;
