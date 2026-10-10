import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const directory = mkdtempSync(join(tmpdir(), 'viec-nho-migration-'))
const databasePath = join(directory, 'legacy.sqlite')

try {
  const legacy = new Database(databasePath)
  legacy.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_date TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `)
  const insert = legacy.prepare('INSERT INTO tasks (id, user_id, title, category, priority, completed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  insert.run('active-task', 'user', 'Keep this active', 'Công việc', 'high', 0, '2026-01-01T00:00:00.000Z')
  insert.run('done-task', 'user', 'Keep this done', 'Cá nhân', 'low', 1, '2026-01-02T00:00:00.000Z')
  legacy.close()

  const migration = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./server/database.js')"], {
    cwd: process.cwd(),
    env: { ...process.env, DB_PATH: databasePath },
    encoding: 'utf8',
  })
  assert.equal(migration.status, 0, migration.stderr || migration.stdout)

  const migrated = new Database(databasePath)
  const rows = migrated.prepare('SELECT id, title, completed, status, project, tags FROM tasks ORDER BY id').all()
  assert.deepEqual(rows, [
    { id: 'active-task', title: 'Keep this active', completed: 0, status: 'todo', project: '', tags: '[]' },
    { id: 'done-task', title: 'Keep this done', completed: 1, status: 'done', project: '', tags: '[]' },
  ])
  const taskColumns = migrated.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name)
  assert.ok(taskColumns.includes('project_id'))
  assert.ok(taskColumns.includes('completed_at'))
  assert.ok(taskColumns.includes('completed_due_date'))
  assert.equal(migrated.prepare('SELECT completed_at, completed_due_date FROM tasks WHERE id = ?').get('done-task').completed_at, null)
  assert.equal(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get()?.name, 'projects')
  assert.equal(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'subtasks'").get()?.name, 'subtasks')
  assert.equal(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'focus_sessions'").get()?.name, 'focus_sessions')
  assert.equal(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'focus_session_segments'").get()?.name, 'focus_session_segments')
  assert.equal(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'habits'").get()?.name, 'habits')
  assert.equal(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'habit_completions'").get()?.name, 'habit_completions')
  assert.ok(migrated.prepare('PRAGMA index_list(habit_completions)').all().some((index) => index.unique === 1))
  const habitCompletionForeignKeys = migrated.prepare('PRAGMA foreign_key_list(habit_completions)').all()
  assert.ok(habitCompletionForeignKeys.some((foreignKey) => foreignKey.table === 'habits' && foreignKey.from === 'habit_id' && foreignKey.to === 'id'))
  assert.ok(habitCompletionForeignKeys.some((foreignKey) => foreignKey.table === 'habits' && foreignKey.from === 'user_id' && foreignKey.to === 'user_id'))
  assert.equal(migrated.pragma('foreign_keys', { simple: true }), 1)
  migrated.close()
  console.log('SQLite migration passed: legacy rows, habit tables and constraints, project relationship, subtasks, and foreign-key configuration.')
} finally {
  rmSync(directory, { recursive: true, force: true })
}