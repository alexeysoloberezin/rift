// Простой раннер миграций: выполняет db/schema.sql целиком, а затем по
// порядку — все файлы db/migrations/NNN_*.sql (если каталог существует).
// Для проекта такого размера полноценный migration-framework избыточен —
// базовая схема одна, версионируется в git; эволюция схемы идёт добавлением
// нумерованных файлов в db/migrations/, каждый из которых пишется так, чтобы
// безопасно перезапускаться на уже накаченной базе (IF NOT EXISTS и т.п.) —
// никакой таблицы "какие миграции уже применены" здесь нет.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, '../../../db/schema.sql');
const migrationsDir = path.resolve(__dirname, '../../../db/migrations');

async function main() {
  console.log(`📄 Читаю схему из ${schemaPath}`);
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  console.log('🚀 Применяю схему к базе...');
  try {
    await pool.query(sql);
    console.log('✅ Схема применена успешно');
  } catch (err) {
    // 42P07 = duplicate_table — schema.sql не идемпотентен (CREATE TABLE без
    // IF NOT EXISTS), поэтому на уже накаченной базе он ожидаемо падает на
    // самой первой таблице. Раньше это было не страшно, т.к. скрипт и не
    // предполагалось гонять повторно; теперь после него ещё выполняются
    // файлы db/migrations/, так что просто пропускаем базовую схему как уже
    // применённую и идём дальше. Любая другая ошибка (опечатка в SQL, обрыв
    // соединения и т.п.) по-прежнему останавливает скрипт.
    if (err.code === '42P07') {
      console.log('ℹ️  Базовая схема уже применена ранее — пропускаю schema.sql');
    } else {
      throw err;
    }
  }

  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      console.log(`📄 Применяю миграцию ${file}...`);
      await pool.query(fs.readFileSync(filePath, 'utf-8'));
      console.log(`✅ ${file} применена`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error('❌ Ошибка миграции:', err.message);
  process.exit(1);
});
