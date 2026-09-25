const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let pool;

if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
  // Use Cloud or Local PostgreSQL (pure JavaScript 'pg', zero GLIBC/C++ native dependencies)
  const { Pool } = require('pg');
  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  // Auto-create tables on PostgreSQL
  pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS generations (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      detected_components TEXT,
      generated_code TEXT NOT NULL,
      screen_name TEXT DEFAULT 'Untitled Screen',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `).catch(err => console.error('PostgreSQL table init error:', err.message));

  pool = {
    query: (text, params) => pgPool.query(text, params),
    type: 'postgres'
  };
  console.log('Connected to PostgreSQL database.');
} else {
  // Pure JavaScript Embedded File Store (Zero native dependencies, 100% GLIBC-free for Render & Local)
  const dataFilePath = path.join(__dirname, '..', 'sketchtoui_store.json');

  const loadData = () => {
    try {
      if (fs.existsSync(dataFilePath)) {
        const raw = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('Error reading store file, initializing fresh store:', err.message);
    }
    return { users: [], generations: [] };
  };

  const saveData = (data) => {
    try {
      fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving to store file:', err.message);
    }
  };

  // Ensure file exists
  if (!fs.existsSync(dataFilePath)) {
    saveData({ users: [], generations: [] });
  }

  pool = {
    type: 'embedded-json',
    query: async (text, params = []) => {
      const data = loadData();
      const trimmed = text.trim();
      const upper = trimmed.toUpperCase();

      // 1. SELECT ... FROM users WHERE email = $1
      if (upper.includes('FROM USERS') && upper.includes('WHERE EMAIL')) {
        const email = String(params[0] || '').toLowerCase();
        const found = data.users.find(u => u.email.toLowerCase() === email);
        return {
          rows: found ? [{ ...found }] : [],
          rowCount: found ? 1 : 0
        };
      }

      // 2. INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email
      if (upper.includes('INSERT INTO USERS')) {
        const email = String(params[0] || '').toLowerCase();
        const password_hash = String(params[1] || '');
        const id = uuidv4();
        const newUser = {
          id,
          email,
          password_hash,
          created_at: new Date().toISOString()
        };
        data.users.push(newUser);
        saveData(data);
        return {
          rows: [{ id, email }],
          rowCount: 1
        };
      }

      // 3. INSERT INTO generations (user_id, image_url, detected_components, generated_code, screen_name) VALUES (...)
      if (upper.includes('INSERT INTO GENERATIONS')) {
        const id = uuidv4();
        const newGen = {
          id,
          user_id: params[0],
          image_url: params[1],
          detected_components: params[2],
          generated_code: params[3],
          screen_name: params[4] || 'Untitled Screen',
          created_at: new Date().toISOString()
        };
        data.generations.push(newGen);
        saveData(data);
        return {
          rows: [{ id }],
          rowCount: 1
        };
      }

      // 4. SELECT ... FROM generations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50
      if (upper.includes('FROM GENERATIONS') && upper.includes('WHERE USER_ID') && !upper.includes('WHERE ID')) {
        const userId = params[0];
        const userGens = data.generations
          .filter(g => g.user_id === userId)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 50)
          .map(g => {
            let comps = g.detected_components;
            if (typeof comps === 'string') {
              try { comps = JSON.parse(comps); } catch (_) {}
            }
            return {
              id: g.id,
              image_url: g.image_url,
              detected_components: comps,
              screen_name: g.screen_name,
              created_at: g.created_at
            };
          });

        return { rows: userGens, rowCount: userGens.length };
      }

      // 5. SELECT * FROM generations WHERE id = $1 AND user_id = $2
      if (upper.includes('FROM GENERATIONS') && upper.includes('WHERE ID')) {
        const id = params[0];
        const userId = params[1];
        const found = data.generations.find(g => g.id === id && (!userId || g.user_id === userId));
        if (found) {
          let comps = found.detected_components;
          if (typeof comps === 'string') {
            try { comps = JSON.parse(comps); } catch (_) {}
          }
          return { rows: [{ ...found, detected_components: comps }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // 6. DELETE FROM generations WHERE id = $1 AND user_id = $2
      if (upper.includes('DELETE FROM GENERATIONS')) {
        const id = params[0];
        const userId = params[1];
        const beforeCount = data.generations.length;
        data.generations = data.generations.filter(g => !(g.id === id && g.user_id === userId));
        saveData(data);
        const changes = beforeCount - data.generations.length;
        return { rows: [], rowCount: changes };
      }

      // Fallback
      return { rows: [], rowCount: 0 };
    }
  };

  console.log('Using zero-config embedded store (100% GLIBC-free for Render & local dev).');
}

module.exports = pool;
