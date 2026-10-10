import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const databasePath = resolve(process.env.DB_PATH ?? './data/todo.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })

export const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refresh_sessions (
    jti TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    replaced_by TEXT
  );
  CREATE INDEX IF NOT EXISTS refresh_sessions_family_idx ON refresh_sessions(family_id);

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
    due_date TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks(user_id);
`)

const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name)
if (!taskColumns.includes('scheduled_at')) {
  db.exec("ALTER TABLE tasks ADD COLUMN scheduled_at TEXT NOT NULL DEFAULT ''")
}
if (!taskColumns.includes('status')) {
  db.exec("ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'")
  db.exec("UPDATE tasks SET status = CASE WHEN completed = 1 THEN 'done' ELSE 'todo' END")
}
if (!taskColumns.includes('project')) db.exec("ALTER TABLE tasks ADD COLUMN project TEXT NOT NULL DEFAULT ''")
if (!taskColumns.includes('tags')) db.exec("ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
if (!taskColumns.includes('completed_at')) db.exec('ALTER TABLE tasks ADD COLUMN completed_at TEXT')
if (!taskColumns.includes('completed_due_date')) db.exec("ALTER TABLE tasks ADD COLUMN completed_due_date TEXT NOT NULL DEFAULT ''")

const projectMigration = db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#55836b',
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id, archived, created_at);
  `)

  const columns = db.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name)
  if (!columns.includes('project_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL')
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id, user_id);
    CREATE INDEX IF NOT EXISTS tasks_completion_idx ON tasks(user_id, completed_at);
    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS subtasks_task_position_idx ON subtasks(task_id, position, created_at);
    CREATE TABLE IF NOT EXISTS focus_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
      planned_duration_seconds INTEGER NOT NULL DEFAULT 1500 CHECK (planned_duration_seconds BETWEEN 60 AND 7200),
      status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'interrupted')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS focus_sessions_user_status_idx ON focus_sessions(user_id, status, started_at);
    CREATE INDEX IF NOT EXISTS focus_sessions_project_idx ON focus_sessions(project_id, user_id);
    CREATE TABLE IF NOT EXISTS focus_session_segments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS focus_segments_session_idx ON focus_session_segments(session_id, started_at);
    CREATE UNIQUE INDEX IF NOT EXISTS focus_segments_one_open_idx ON focus_session_segments(session_id) WHERE ended_at IS NULL;
  `)
})
projectMigration()

db.transaction(() => db.exec(`
  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'sparkles',
    color TEXT NOT NULL DEFAULT '#55836b',
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
    weekly_target INTEGER NOT NULL CHECK (weekly_target BETWEEN 1 AND 7),
    start_date TEXT NOT NULL,
    end_date TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (id, user_id)
  );
  CREATE INDEX IF NOT EXISTS habits_user_active_idx ON habits(user_id, archived, created_at);
  CREATE TABLE IF NOT EXISTS habit_completions (
    id TEXT PRIMARY KEY,
    habit_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    completion_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (habit_id, completion_date),
    FOREIGN KEY (habit_id, user_id) REFERENCES habits(id, user_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS habit_completions_user_date_idx ON habit_completions(user_id, completion_date);
  CREATE INDEX IF NOT EXISTS habit_completions_habit_date_idx ON habit_completions(habit_id, completion_date);
`))()