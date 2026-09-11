import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';

const router = Router();

// POST /api/auth/login — вход админа
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Укажите email и пароль' });
    }

    const { rows } = await query('SELECT * FROM admins WHERE email = $1', [email.toLowerCase()]);
    const admin = rows[0];

    if (!admin) {
      return res.status(401).json({ success: false, error: 'Неверный email или пароль' });
    }

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Неверный email или пароль' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role, name: admin.display_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      token,
      admin: { id: admin.id, email: admin.email, name: admin.display_name, role: admin.role },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/auth/register-first-admin — создать первого админа (работает только если админов ещё нет)
// Нужно, чтобы не хардкодить пароль в коде/сидах. После первого запуска этот путь сам себя закрывает.
router.post('/register-first-admin', async (req, res) => {
  try {
    const { rows: existing } = await query('SELECT COUNT(*)::int AS count FROM admins');
    if (existing[0].count > 0) {
      return res.status(403).json({
        success: false,
        error: 'Админ уже существует. Используйте вход или попросите существующего админа создать вам доступ.',
      });
    }

    const { email, password, displayName } = req.body;
    if (!email || !password || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Укажите email и пароль (минимум 8 символов)',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO admins (email, password_hash, display_name, role)
       VALUES ($1, $2, $3, 'superadmin')
       RETURNING id, email, display_name, role`,
      [email.toLowerCase(), passwordHash, displayName || email]
    );

    res.json({ success: true, admin: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
