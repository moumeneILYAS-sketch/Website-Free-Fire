'use strict';

const fs = require('node:fs');
const path = require('node:path');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run database migrations. Copy .env.example and configure PostgreSQL.');
  }
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
  });
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(schema);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    console.log('BlueDrop database schema is ready.');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;
});
