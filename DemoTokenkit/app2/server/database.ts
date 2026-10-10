import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import pathModule from 'node:path';

export function createDatabase(databasePath: string): Database.Database {
  if (databasePath !== ':memory:') mkdirSync(pathModule.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refresh_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS refresh_sessions_user_id ON refresh_sessions(user_id);
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#56846c',
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_user_id ON projects(user_id);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Công việc',
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
      due_date TEXT NOT NULL DEFAULT '',
      scheduled_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      completed_at TEXT,
      legacy_project TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_user_id ON tasks(user_id);
    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS subtasks_task_position ON subtasks(task_id, position);
    CREATE TABLE IF NOT EXISTS focus_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      started_at TEXT NOT NULL,
      active_started_at TEXT,
      ended_at TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
      expected_duration_seconds INTEGER NOT NULL CHECK (expected_duration_seconds BETWEEN 60 AND 7200),
      status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'interrupted')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS focus_sessions_user_ended_at ON focus_sessions(user_id, ended_at);
    CREATE UNIQUE INDEX IF NOT EXISTS focus_sessions_one_active_per_user ON focus_sessions(user_id) WHERE status IN ('running', 'paused');
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Cá nhân',
      icon TEXT NOT NULL DEFAULT '✨',
      color TEXT NOT NULL DEFAULT '#56846c',
      frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly')),
      weekly_target INTEGER NOT NULL DEFAULT 1 CHECK (weekly_target BETWEEN 1 AND 7),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS habits_user_archived ON habits(user_id, archived, created_at);
    CREATE TABLE IF NOT EXISTS habit_completions (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      completion_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (habit_id, completion_date)
    );
    CREATE INDEX IF NOT EXISTS habit_completions_user_date ON habit_completions(user_id, completion_date);
    CREATE INDEX IF NOT EXISTS habit_completions_habit_date ON habit_completions(habit_id, completion_date);
  `);
  const taskColumns = database.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
  if (!taskColumns.some((column) => column.name === 'project_id')) {
    database.exec('ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL');
  }
  if (!taskColumns.some((column) => column.name === 'completed_at')) {
    database.exec('ALTER TABLE tasks ADD COLUMN completed_at TEXT');
  }
  database.exec('CREATE INDEX IF NOT EXISTS tasks_project_id ON tasks(project_id)');
  database.exec('CREATE INDEX IF NOT EXISTS tasks_user_completed_at ON tasks(user_id, completed_at)');
  return database;
}