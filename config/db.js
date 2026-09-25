const path = require('path');
const { v4: uuidv4 } = require('uuid');

let pool;

if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
  // Use Cloud or Local PostgreSQL
  const { Pool } = require('pg');
  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  pool = {
    query: (text, params) => pgPool.query(text, params),
    type: 'postgres'
  };
  console.log('Connected to PostgreSQL database.');
} else {
  // Free local/embedded zero-config fallback (SQLite)
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(__dirname, '..', 'sketchtoui.db');
  const db = new sqlite3.Database(dbPath);

  // Initialize tables
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS generations (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        image_url TEXT NOT NULL,
        detected_components TEXT,
        generated_code TEXT NOT NULL,
        screen_name TEXT DEFAULT 'Untitled Screen',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  });

  pool = {
    type: 'sqlite',
    query: (text, params = []) => {
      return new Promise((resolve, reject) => {
        // Adapt $1, $2 syntax to ?
        let adaptedSql = text.replace(/\$\d+/g, '?');
        const trimmed = adaptedSql.trim();
        const isSelect = trimmed.toUpperCase().startsWith('SELECT');
        const isInsert = trimmed.toUpperCase().startsWith('INSERT');
        const hasReturning = /RETURNING\s+([a-zA-Z0-9_,\s*]+)/i.test(adaptedSql);

        if (isInsert && hasReturning) {
          // Emulate RETURNING in SQLite
          adaptedSql = adaptedSql.replace(/RETURNING\s+([a-zA-Z0-9_,\s*]+)/i, '').trim();
          const generatedId = uuidv4();
          
          // If inserting users and needs id
          if (trimmed.toUpperCase().includes('INSERT INTO USERS')) {
            // Ensure first param or explicit id
            adaptedSql = adaptedSql.replace('INSERT INTO users (email', 'INSERT INTO users (id, email');
            adaptedSql = adaptedSql.replace('VALUES (?, ?)', 'VALUES (?, ?, ?)');
            params = [generatedId, ...params];
          }

          db.run(adaptedSql, params, function (err) {
            if (err) return reject(err);
            resolve({
              rows: [{ id: generatedId, email: params[1] || '' }]
            });
          });
        } else if (isInsert) {
          // If inserting generations, generate UUID for id
          if (trimmed.toUpperCase().includes('INSERT INTO GENERATIONS')) {
            adaptedSql = adaptedSql.replace(
              'INSERT INTO generations (user_id',
              'INSERT INTO generations (id, user_id'
            );
            adaptedSql = adaptedSql.replace(
              'VALUES (?, ?, ?, ?, ?)',
              'VALUES (?, ?, ?, ?, ?, ?)'
            );
            params = [uuidv4(), ...params];
          }

          db.run(adaptedSql, params, function (err) {
            if (err) return reject(err);
            resolve({ rows: [], rowCount: this.changes });
          });
        } else if (isSelect) {
          db.all(adaptedSql, params, (err, rows) => {
            if (err) return reject(err);
            // Parse detected_components JSON if string
            const parsedRows = (rows || []).map(r => {
              if (r.detected_components && typeof r.detected_components === 'string') {
                try {
                  r.detected_components = JSON.parse(r.detected_components);
                } catch (e) {}
              }
              return r;
            });
            resolve({ rows: parsedRows });
          });
        } else {
          db.run(adaptedSql, params, function (err) {
            if (err) return reject(err);
            resolve({ rows: [], rowCount: this.changes });
          });
        }
      });
    }
  };
  console.log('Using zero-config SQLite database (or set DATABASE_URL in .env for Cloud PostgreSQL).');
}

module.exports = pool;
