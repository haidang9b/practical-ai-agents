Todo App

A modern, minimalist Todo application built with React, TypeScript, Vite, Tailwind CSS, and Express.

The app includes an interactive Kanban board, project planning, reusable project templates, task checklists, and a productivity analytics dashboard with a persisted Pomodoro timer.

✨ Features
✅ Create, edit, delete, and complete tasks
📝 Add descriptions, priorities, categories, and due dates
🔍 Search, filter, and sort tasks
📊 Dashboard with task statistics
🌙 Light and dark themes
💾 Account-owned SQLite persistence
📱 Responsive design for desktop and mobile
🇻🇳 Vietnamese user interface
📁 Account-owned projects with task progress and templates
☑️ Persisted, reorderable task subtasks
📈 Completion, on-time, weekly focus, and habit-streak analytics
⏱️ Server-timed Pomodoro focus sessions linked to tasks and projects
🔁 Account-owned daily and weekly habit tracking with history and streaks
🛠️ Tech Stack
React
TypeScript
Vite
Tailwind CSS
Express
SQLite
JWT access and refresh tokens
Lucide React
Vitest
React Testing Library
🚀 Getting Started
Prerequisites
Node.js (LTS recommended)
npm
Installation
git clone <your-repository-url>
cd <your-project-folder>
npm install

Configure Authentication
Copy `.env.example` to `.env` and replace both JWT secrets with different random values of at least 32 characters before deploying.
The development server uses local-only fallback secrets. Never use those defaults in production.
SQLite data is stored in `data/todo.sqlite` by default.

### Frontend and Backend Authentication

There is no preconfigured username or password and no separate username field. Select **Đăng ký** in the frontend to create an account; the backend validates and stores the account:

| Field | Frontend | Backend |
| --- | --- | --- |
| Name | Required on registration; up to 70 characters | Trimmed; 1-70 characters |
| Email (login ID) | Required valid email; up to 254 characters | Valid email; trimmed, normalized to lowercase, up to 254 characters |
| Password | Required; at least 8 characters on registration, up to 72 characters | At least 8 and at most 72 UTF-8 bytes |

Use the registered email and password to log in. The name is only needed when registering. The backend remains authoritative and rejects invalid registration or login requests even if a client bypasses frontend validation.

Run Development Server
npm run dev

On Windows, you can start both the Vite frontend and Express backend by running `.\run-app.ps1` from PowerShell in the project folder. The frontend is at `http://localhost:5173`; the backend API listens on `http://localhost:3001`.

Open the local URL shown in your terminal.

📜 Available Scripts
Command	Description
npm run dev	Start development server
npm start	Start the production Express server after building
npm run build	Build for production
npm run preview	Preview production build
npm run test	Run tests
npm run test:watch	Run tests in watch mode
npm run test:api	Run auth and API integration checks (start the server first)
npm run test:migration	Verify legacy SQLite task migration
npm run test:analytics	Verify analytics calculations, timezone boundaries, and streaks
npm run test:habits	Verify habit date, streak, weekly-goal, and archive calculations
npm run lint	Check code quality
npm run typecheck	Check TypeScript types
📁 Project Structure
src/
├── App.tsx
├── components/
│   ├── AnalyticsPage.tsx
│   ├── HabitTrackerPage.tsx
│   └── AuthScreen.tsx
├── lib/
│   ├── api.ts
│   └── storage.ts
├── styles.css
├── types/
│   └── task.ts
└── main.tsx
tests/
├── App.test.tsx
└── setup.ts
server/
├── database.js
├── analytics.js
├── index.js
└── tokens.js
scripts/
├── test-api.mjs
├── test-analytics.mjs
└── test-migration.mjs
index.html
package.json
vite.config.ts
tailwind.config.js

💾 Data Storage

Theme preferences are saved in browser localStorage. Accounts, projects, tasks, subtasks, habits, and habit completions are stored in the existing SQLite database on the Express server. Task calendar placement is saved as optional `scheduledAt`, separately from deadline `dueDate`. Existing tasks continue to appear on their due date until a planned date is set.

### Database Migration

The startup migration in `server/database.js` runs automatically. It uses additive, idempotent SQLite DDL inside a transaction to create `projects`, `subtasks`, `focus_sessions`, `focus_session_segments`, `habits`, and `habit_completions`, and add nullable task relationship/completion fields; it never drops or recreates existing tables. Existing tasks remain unassigned and existing text-based Kanban project labels are retained. Historical tasks are not assigned invented completion timestamps. SQLite foreign-key enforcement is enabled by the existing database connection. There is no separate migration command or down-migration framework in this app.

Before deploying against important data, stop the server and copy the configured SQLite file (default: `data/todo.sqlite`). If startup is interrupted or rollback is needed, stop the server and restore that backup; the migration can be run again. Verify a legacy upgrade with `npm run test:migration`.

Data persists after refreshing the page.
Passwords are stored as bcrypt hashes. Access JWTs expire after 10 minutes and stay in frontend memory. Refresh JWTs expire after 7 days, are rotated on use, and are sent in an HttpOnly, SameSite=Strict cookie.
Refresh tokens are stored server-side only as SHA-256 hashes; reusing a rotated token revokes that token family.
Use `npm run test:api` while the development server is running to exercise login, refresh, logout, analytics date validation, focus-session lifecycle and ownership, project ownership and deletion, task assignment, templates, subtasks, and progress calculation.

## Calendar & Weekly Planner

Open **Lịch & kế hoạch** in the sidebar to switch between Day, Week, and Month views. Use the previous/next controls to move through the calendar and **Hôm nay** to return to the current date. Select a day or its plus button to create a task on that date. Open a calendar task to edit its details, deadline, planned date, and optional start time.

Drag a task onto another date to update `scheduledAt` without changing its deadline or other details. Tasks without a planned date or deadline remain in the task list and are safely omitted from the calendar grid. Use the status, category, and priority filters to narrow the calendar. The weekly summary and deadline list show completed, remaining, and overdue work. The calendar follows the existing light/dark theme and scrolls horizontally for narrow weekly layouts.

## Kanban Board

Open **Bảng Kanban** in the sidebar to view tasks in To Do, In Progress, and Done columns. Drag a card between columns, or use its status selector for a keyboard-accessible move. Status changes save immediately through the existing task API, and the `completed` field stays synchronized for the task list and calendar.

Create or edit a task to assign a project and comma-separated tags. The board combines project, tag, priority, due-date, and title/description search filters; **Xóa bộ lọc** clears them. Sort cards by priority, due date, or creation date. Cards highlight overdue and high-priority tasks, and selecting a title opens its details in the existing task editor.

The legacy project label, tags, and status are stored with each account-owned task in SQLite; formal project assignments use the nullable `project_id` relationship. On startup, existing rows are migrated: incomplete tasks become `todo`, completed tasks become `done`, and legacy project/tag values start empty. The board follows the app's light/dark theme and stacks columns on narrow screens.

## Projects, Subtasks & Templates

Open **Dự án** in the sidebar to create, edit, archive, and inspect projects. Details show associated tasks and persisted total, active, completed, overdue, and completion statistics. Assign a task in its editor or create one from a project. The task list can filter by a project or show unassigned tasks. Existing free-text Kanban project labels remain supported.

Deleting a project always asks for an explicit choice: move its tasks to the unassigned state, or delete the project and its tasks. Both actions require confirmation. Archived projects remain stored and can be shown with the archived-project toggle.

Edit a task to add a checklist. Subtasks can be renamed, completed, reordered, and removed; blank titles are rejected. The checklist displays completed/total progress and can be collapsed. Updating a parent task does not replace or delete its subtasks.

The built-in **Dự án học tập**, **Dự án công việc**, and **Dự án cá nhân** templates can be previewed and customized before creating a project with its initial persisted tasks.

Project completion is `completed parent tasks / all assigned parent tasks`, rounded to the nearest integer percentage. A project with no tasks is 0%. Subtasks are not included in the project denominator, avoiding double counting; their completion is reported separately. An active task has `completed = false`. Overdue means an incomplete task has a non-empty `dueDate` earlier than the server's current local calendar date. Archived projects are excluded from the default active-project view.

Authenticated routes use the existing Bearer access token and refresh-cookie flow: `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `GET /api/project-templates`, `POST /api/projects/from-template`, and task-scoped `GET/POST /api/tasks/:taskId/subtasks` plus `PATCH/DELETE /api/tasks/:taskId/subtasks/:subtaskId`. Task collection routes accept `?projectId=<uuid>` or `?projectId=unassigned`. Project deletion expects `{ "taskBehavior": "unassign" }` or `{ "taskBehavior": "delete" }`.

## Productivity Analytics

Open **Phân tích** in the sidebar. The dashboard supports day, week, and month navigation, explicit start/end dates, project filtering, task-completion comparisons with the preceding equal-length date range, on-time completion, daily and weekly focus charts, project breakdowns, and a 365-day activity heatmap. Charts use authenticated API responses derived from SQLite. The browser's current IANA timezone is sent with analytics requests; date inputs and Vietnamese labels use the browser's local calendar.

Calculation rules:

- Daily completions count each task's persisted `completed_at` on its local calendar date. Creation counts use `created_at`; the outstanding count is all currently incomplete tasks in the selected project scope, not only tasks created in the range.
- On-time rate is `completed on/before due date / completed tasks with a due date * 100`. It is limited to tasks completed in the selected range. The due date is snapshotted as `completed_due_date` when completion occurs, so editing a completed task's due date does not rewrite its result. Tasks without a due date are excluded. No eligible tasks displays `—`; overdue counts are current incomplete tasks with a due date before today.
- Reopening a task clears its current completion timestamp and due-date snapshot. Since this app has no task event log, a reopened task is not included as a historical completion; completing it again records a new timestamp. Deleting a task removes it from task analytics. Existing completed tasks are not assigned invented completion dates and therefore do not appear in historical completion or on-time totals until completed again.
- Focus sessions consist of server-timestamped running segments. Paused intervals are excluded. Completed segments are clipped to each local calendar day, including daylight-saving transitions, then grouped into Monday-start calendar weeks. Only completed sessions count in productivity totals; interrupted sessions are retained but excluded from charts. A session must meet its server-validated planned duration; a client's duration value is never accepted as elapsed time.
- The current streak counts consecutive local dates ending today, or yesterday when today has no activity, that meet the configured completed-task goal. Longest streak is calculated across available completion history. Future dates are excluded. The goal and Pomodoro durations are local browser preferences; they default to one task, 25 focus minutes, and 5 break minutes.
- Analytics use the timezone sent by the authenticated browser on each request; changing device timezone changes local-day grouping. Date ranges are limited to 366 days. Task history before this migration has no reliable completion time and is intentionally unavailable. Hard-deleted tasks and reopened completion events cannot be reconstructed without an event-history schema.

## Habit Tracker

Open **Thói quen** in the sidebar to create daily habits or weekly goals, choose a category, icon, and color, mark today or a past date complete, and view a 12-week activity heatmap. The heatmap outlines missed eligible daily habits; weekly habits are judged by their weekly target, not by individual weekdays. Habits can be edited, archived and restored, or deleted with their completion history. Archived habits retain statistics and heatmap history, but are excluded from active daily and weekly progress. Editing a habit never rewrites its completion records.

Habit dates are date-only `YYYY-MM-DD` values interpreted in the browser's IANA timezone sent with the request; the server does not convert a date-only value through UTC. Future completions are rejected. The daily current streak ends today when complete, otherwise yesterday; a missed date breaks it. Weekly habits use Monday-start calendar weeks. A week qualifies when it reaches its target; an incomplete current week is ignored when measuring the current weekly streak, so it does not break the previous qualified-week streak. Longest streaks count consecutive qualifying dates for daily habits and consecutive qualifying weeks for weekly habits. There is no skip or pause policy. A habit is eligible only on or after its start date and on or before its optional end date; archive time stops new eligibility, while earlier completion history remains available. Weekly completion counts may be on any weekday.

Authenticated habit routes derive account ownership from the existing Bearer access token. Completion rows have a unique `(habit_id, completion_date)` constraint; repeated PUT requests are idempotent. List and history ranges are limited to 366 days.

| Route | Purpose |
| --- | --- |
| `GET /api/habits?archived=false\|true\|all` | List the user's active, archived, or all habits |
| `GET /api/habits/:id` | Read a habit and its recent completion dates |
| `POST /api/habits` | Create a daily or weekly habit |
| `PATCH /api/habits/:id` | Edit a habit or restore an archived habit |
| `POST /api/habits/:id/archive` | Archive a habit without deleting history |
| `DELETE /api/habits/:id` | Delete a habit and its completion records |
| `GET /api/habits/:id/completions?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&timezone=Area/Location` | Read completion dates in a bounded range |
| `PUT /api/habits/:id/completions/:date?timezone=Area/Location` | Record a completion; duplicate writes are harmless |
| `DELETE /api/habits/:id/completions/:date?timezone=Area/Location` | Undo a completion |
| `GET /api/habit-analytics/summary?date=YYYY-MM-DD&timezone=Area/Location` | Daily, weekly, monthly, habit-rate, and streak statistics |
| `GET /api/habit-analytics/history?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&timezone=Area/Location` | Daily completion counts for the activity heatmap |

Run `npm run test:habits` for deterministic date and streak checks, `npm run test:migration` for schema constraints and legacy data preservation, and `npm run test:api` (with the server running) for authenticated habit CRUD, completion, and ownership checks.

New authenticated routes use the existing Bearer access-token middleware and derive ownership from the verified JWT:

| Route | Purpose |
| --- | --- |
| `GET /api/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&timezone=Area/Location&projectId=<uuid>&dailyGoal=1` | Completion, on-time, focus, streak, activity, and project analytics |
| `GET /api/focus-sessions/active` | Restore the user's running or paused focus session |
| `POST /api/focus-sessions` | Start a session with planned seconds and optional `taskId` or `projectId` |
| `POST /api/focus-sessions/:id/pause` | Close the current server-timed segment |
| `POST /api/focus-sessions/:id/resume` | Start a new timed segment after pause |
| `POST /api/focus-sessions/:id/complete` | Complete only after the planned duration; idempotent for completed sessions |
| `POST /api/focus-sessions/:id/interrupt` | Persist an interrupted session without counting it as completed focus |

The analytics calculation, migration, and API checks are available as `npm run test:analytics`, `npm run test:migration`, and `npm run test:api` respectively.

🧪 Testing

Run automated tests:

npm run test


Check TypeScript:

npm run typecheck


Run linting:

npm run lint


Build the application:

npm run build

📦 Production

The production build is generated in the dist/ directory. Express serves the built client and API from one origin.

npm run build
Set `NODE_ENV=production` and configure both JWT secrets in `.env`, then run `npm start`.

🤝 Contributing
Create a feature branch.
Implement your changes.
Run tests and code-quality checks.
Submit a pull request.
📄 License

This project is available under the MIT License unless otherwise specified.

Built with ❤️ using React and TypeScript.