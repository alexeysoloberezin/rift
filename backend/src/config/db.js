import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('❌ Неожиданная ошибка пула Postgres:', err);
});

/**
 * Простой хелпер для запросов с логом времени выполнения в dev-режиме.
 */
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.NODE_ENV !== 'production') {
    const duration = Date.now() - start;
    console.log('🗄️  SQL', { text, duration, rows: res.rowCount });
  }
  return res;
}

/**
 * Выполнить несколько запросов в одной транзакции.
 * fn получает клиента с тем же интерфейсом query(text, params).
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({ query: (text, params) => client.query(text, params) });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
