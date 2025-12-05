import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

/**
 * Get or create the database connection.
 * @param {string} dbPath - Path to the SQLite database file.
 * @returns {Database.Database} The database instance.
 */
export function getDatabase(dbPath = './data/discord.db') {
  if (db) return db;

  // Ensure data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable foreign keys and WAL mode for better performance
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  return db;
}

/**
 * Close the database connection.
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run all pending migrations.
 * @param {Database.Database} database - The database instance.
 */
export function runMigrations(database) {
  const migrationsDir = path.join(__dirname, 'migrations');

  // Create migrations tracking table if it doesn't exist
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Get list of applied migrations
  const applied = new Set(
    database.prepare('SELECT name FROM _migrations').all().map(row => row.name)
  );

  // Get all migration files
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let migrationsRan = 0;

  for (const file of migrationFiles) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    console.log(`Running migration: ${file}`);

    // Run migration in a transaction
    const runMigration = database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    });

    runMigration();
    migrationsRan++;
  }

  if (migrationsRan > 0) {
    console.log(`Applied ${migrationsRan} migration(s)`);
  } else {
    console.log('Database is up to date');
  }
}

/**
 * Initialize the database (create and run migrations).
 * @param {string} dbPath - Path to the SQLite database file.
 * @returns {Database.Database} The initialized database instance.
 */
export function initDatabase(dbPath = './data/discord.db') {
  const database = getDatabase(dbPath);
  runMigrations(database);
  return database;
}

/**
 * Get database statistics.
 * @param {Database.Database} database - The database instance.
 * @returns {Object} Statistics about the database contents.
 */
export function getDatabaseStats(database) {
  const stats = {};

  const tables = ['guilds', 'channels', 'users', 'messages', 'embeds', 'attachments', 'reactions'];

  for (const table of tables) {
    try {
      const result = database.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
      stats[table] = result.count;
    } catch {
      stats[table] = 0;
    }
  }

  // Get date range of messages
  try {
    const dateRange = database.prepare(`
      SELECT
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest
      FROM messages
    `).get();
    stats.oldestMessage = dateRange.oldest;
    stats.newestMessage = dateRange.newest;
  } catch {
    stats.oldestMessage = null;
    stats.newestMessage = null;
  }

  // Get database file size
  try {
    const dbFile = database.pragma('database_list')[0];
    if (dbFile && dbFile.file) {
      const fileStat = fs.statSync(dbFile.file);
      stats.fileSizeBytes = fileStat.size;
      stats.fileSizeMB = (fileStat.size / 1024 / 1024).toFixed(2);
    }
  } catch {
    stats.fileSizeBytes = 0;
    stats.fileSizeMB = '0.00';
  }

  return stats;
}

export default {
  getDatabase,
  closeDatabase,
  runMigrations,
  initDatabase,
  getDatabaseStats,
};
