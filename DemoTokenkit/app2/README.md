Todo App

A modern, minimalist Todo application built with React, TypeScript, Vite, and Tailwind CSS.

Express powers the authenticated API. User accounts, refresh sessions, projects, tasks, and subtasks are stored in SQLite.

✨ Features
✅ Create, edit, delete, and complete tasks
📁 Create and manage projects, archive them, and track task progress
✨ Create daily or weekly habits, track dated completions, streaks, weekly targets, and activity history
☑️ Add, edit, reorder, and complete one-level subtasks
🧩 Start projects from Study, Work, and Personal templates
📝 Add descriptions, priorities, categories, and due dates
🗂️ Manage tasks on a three-column Kanban board
🏷️ Organize tasks by project and multiple tags
🗓️ Plan tasks in day, week, and month calendar views
↔️ Reschedule tasks by dragging them to another date
🔍 Search, filter, and sort tasks
📊 Productivity analytics with completion, on-time, focus, and streak summaries
🌙 Light and dark themes
💾 SQLite task persistence with a one-time localStorage import
📱 Responsive design for desktop and mobile
🇻🇳 Vietnamese user interface
🛠️ Tech Stack
React
TypeScript
Vite
Tailwind CSS
Lucide React
Recharts
Vitest
React Testing Library
Express
SQLite
JWT and bcrypt
🚀 Getting Started
Prerequisites
Node.js (LTS recommended)
npm
Installation
git clone <your-repository-url>
cd <your-project-folder>
npm install
Copy-Item .env.example .env

Run Development Server
npm run dev


Open the local URL shown in your terminal.

The client runs at the Vite URL shown in the terminal and proxies `/api` to Express on port 3002. Create an account from the login screen. The SQLite database is created at `data/auth.sqlite`. Set distinct random `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` values in `.env`; keep that file private. `VITE_API_BASE_URL` defaults to `/api` and can be set to a separate backend base URL when needed.

### Default Account

There is no built-in default username, name, or password. Create an account from the login screen using an email address and a password of at least 10 characters. The email is the account identifier; this app does not currently have a separate username or display-name field.

📜 Available Scripts
Command	Description
npm run dev	Start development server
npm run build	Build for production
npm run preview	Preview production build
npm run test	Run tests
npm run test:watch	Run tests in watch mode
npm run lint	Check code quality
npm run typecheck	Check TypeScript types
📁 Project Structure
src/
├── components/
│   ├── AuthScreen.tsx
│   ├── CalendarView.tsx
│   ├── KanbanBoard.tsx
│   ├── ProjectsPage.tsx
│   └── SubtaskList.tsx
├── lib/
│   ├── api.ts
│   ├── authApi.ts
│   ├── calendar.ts
│   └── taskStorage.ts
├── App.tsx
├── styles.css
└── types.ts
server/
├── app.ts
├── database.ts
└── index.ts

💾 Data Storage

Projects, tasks, and subtasks are stored in the existing SQLite database and scoped to the authenticated account. Theme preferences remain in browser localStorage. On first login after this update, any account-specific task list already saved in localStorage is imported into SQLite; once synchronized, SQLite is authoritative and the browser copy is retained as a compatibility cache.
Projects, tasks, subtasks, habits, and habit completions are stored in the existing SQLite database and scoped to the authenticated account. Theme preferences remain in browser localStorage. On first login after this update, any account-specific task list already saved in localStorage is imported into SQLite; once synchronized, SQLite is authoritative and the browser copy is retained as a compatibility cache. Habits are never stored in localStorage as their primary data source.

Passwords are hashed with bcrypt. Access JWTs expire after 15 minutes and stay in browser memory. Refresh JWTs expire after 7 days, use an HttpOnly, SameSite=Strict cookie, and rotate on refresh. Only hashes of refresh tokens are stored in SQLite. Logout revokes the current refresh session. Production requires both JWT secrets and uses Secure cookies; serve over HTTPS.

### Database migration and progress

Database initialization runs idempotent SQLite schema upgrades when the server starts. It creates `projects`, `tasks`, `subtasks`, and `focus_sessions` if absent, adds nullable `project_id` and `completed_at` columns to a legacy `tasks` table when required, and creates supporting indexes. Existing tables and task records are not dropped or recreated. Historical completed tasks are not assigned invented completion dates; their `completed_at` remains `NULL` until a later completion transition. Back up `data/auth.sqlite` before upgrading a production deployment. Foreign-key enforcement is enabled on each SQLite connection.
Database initialization runs idempotent SQLite schema upgrades when the server starts. It creates `projects`, `tasks`, `subtasks`, `focus_sessions`, `habits`, and `habit_completions` if absent, adds nullable `project_id` and `completed_at` columns to a legacy `tasks` table when required, and creates supporting indexes. Existing tables and task records are not dropped or recreated. Habit completions have a unique `(habit_id, completion_date)` constraint and cascade when their habit or user is deleted. Historical completed tasks or habits are not assigned invented completion dates. Back up `data/auth.sqlite` before upgrading a production deployment. Foreign-key enforcement is enabled on each SQLite connection.

Project completion is `completed tasks / all project tasks`, rounded to the nearest integer; a project without tasks is 0%. Subtasks are excluded from project totals so parent tasks are never double-counted. Overdue means an incomplete task whose due date is before the server's local calendar date. The active project list excludes archived projects.

### Project and task API

All routes require the existing access JWT in `Authorization: Bearer <token>`. IDs are scoped to the authenticated user, and task assignment verifies project ownership.

| Method | Route | Purpose |
| --- | --- | --- |
| GET/POST | `/api/projects` | List projects with counts / create a project |
| GET/PATCH/DELETE | `/api/projects/:id` | Read details / edit or archive / delete |
| GET | `/api/project-templates` | List built-in templates |
| POST | `/api/projects/from-template` | Create a project and initial tasks |
| GET/POST | `/api/tasks` | List (optional `?projectId=<id>` or `unassigned`) / create tasks |
| POST | `/api/tasks/import` | Import the account's legacy browser task list |
| PATCH/DELETE | `/api/tasks/:id` | Update or delete a task |
| GET/POST | `/api/tasks/:taskId/subtasks` | List or create one-level subtasks |
| PATCH | `/api/tasks/:taskId/subtasks/:subtaskId` | Edit, complete, or reposition a subtask |
| PATCH | `/api/tasks/:taskId/subtasks/reorder` | Reorder with `{ "ids": [...] }` |
| DELETE | `/api/tasks/:taskId/subtasks/:subtaskId` | Delete a subtask |
| GET/POST | `/api/habits` | List (optional `?archived=true|false`) / create a habit |
| GET/PATCH/DELETE | `/api/habits/:id` | Read, update/archive/restore, or delete an owned habit |
| POST | `/api/habits/:id/archive` | Archive an owned habit |
| GET | `/api/habits/:id/completions?from=YYYY-MM-DD&to=YYYY-MM-DD` | Read dated completion history |
| PUT/DELETE | `/api/habits/:id/completions/:date` | Record or undo a completion for a date |
| GET | `/api/habit-analytics/summary` | Today's progress and per-habit streak/weekly statistics |
| GET | `/api/habit-analytics/history?from=YYYY-MM-DD&to=YYYY-MM-DD` | Completion activity for up to 366 days |
| GET | `/api/analytics` | Completion, on-time, focus, activity, streak, and project summaries; accepts `from`, `to`, `timeZone`, `dailyGoal`, and optional `projectId` |
| GET | `/api/focus-sessions/active` | Restore the authenticated user's running or paused Pomodoro session |
| POST | `/api/focus-sessions` | Start a server-timed focus session with optional task/project association |
| POST | `/api/focus-sessions/:id/pause`, `/resume` | Pause or resume an owned session |
| POST | `/api/focus-sessions/:id/complete`, `/interrupt` | Complete a valid session or mark it interrupted |

Deleting a project with tasks requires `?tasks=unassign` or `?tasks=delete`; requests without an explicit choice return 400. Template IDs are `study`, `work`, and `personal`.

### Habit tracker

Choose **Thói quen** in the workspace navigation. Create a habit with a category, icon, color, start date, optional end date, and either a daily frequency or a weekly target from 1 to 7 completions. The dashboard shows today's progress, current and longest streaks, weekly progress, archive filters, and a date-navigable activity heatmap. Select a habit in the history view to add or remove historical completions; future dates and dates outside that habit's active range are disabled.

All habit routes use the existing access JWT. The server derives user identity from the verified token and scopes every read and write to that user. Completion dates are stored as date-only `YYYY-MM-DD` values, while audit timestamps are UTC ISO instants. The client sends its IANA timezone; the API uses it to decide the current local date. The default timezone is `Asia/Ho_Chi_Minh` when a caller does not supply one.

Streak and history rules:

- Daily current streak counts consecutive completed dates ending today, or yesterday if today is not yet complete. Any missed date breaks the streak; no skip-day policy is implemented. Longest streak is the maximum consecutive run.
- Weekly habits can be completed on any day. Weeks run Monday through Sunday and qualify once their target count is reached. A current incomplete week is not counted as a current streak week; the current streak anchors at the most recent completed qualifying week. Longest streak counts consecutive qualifying weeks, not days.
- Completions before the start date, after the optional end date, or after today are ignored in statistics. Archived habits retain their completion history and statistics but are excluded from today's active denominator. Pausing is not implemented.
- Daily completion rate is completed eligible dates divided by eligible calendar dates. Weekly completion rate is goal-qualified weeks divided by calendar weeks in the eligible interval. Weekly progress is capped at the configured target; additional completions remain visible in history.
- Daily, weekly, and monthly history views use local calendar boundaries and may be navigated into the past. Date-only keys are never converted as UTC instants.

### Local task import

On the first authenticated sync, a browser's existing account-specific task list is imported into SQLite if the server has no tasks for that account. Later task changes are stored on the server; localStorage remains a compatibility cache, not the authoritative database.

### Productivity analytics and focus timer

Choose **Phân tích** in the workspace navigation. The **Ngày** view covers the latest 14 local calendar days, **Tuần** covers Monday through Sunday, and **Tháng** covers the selected local month. Use the arrows to move periods or choose **Tùy chọn** for a date range of up to 366 days. The heatmap independently shows the latest 365 local calendar days. The dashboard sends the browser's IANA timezone to the authenticated API; date-only deadlines remain calendar dates and are not converted as UTC instants.

Calculation and data-retention rules:

- **Completions per day** use the server-recorded `completed_at` instant converted to the selected timezone. A task is counted only while its current status is complete. Reopening clears `completed_at`; completing it again records the new completion time, so the previous cycle is not counted twice. Deleted tasks disappear from analytics because task deletion is permanent.
- **Created, completed, and remaining** count task creations in the selected local-date range, current completions in that range, and tasks created in the range that are currently open. The overdue count is the current number of open tasks whose due date is before today in the selected timezone.
- **On-time rate** is `completed on or before due date / completed tasks with a due date × 100`. Completion is compared as a local calendar date; finishing on the due date is on time. Tasks without deadlines are excluded. An empty eligible set is shown as `—`, not 0%.
- **Historical compatibility:** a task already complete before this migration has no reliable completion instant. It remains visible in task lists but is omitted from completion-by-day, on-time, and streak history until it is reopened and completed again. No historical completion date is guessed.
- **Focus sessions** are created and timed by the server. Pause/resume accumulate only server-measured active seconds. A completed session is counted once and allocated in full to the local calendar week containing its `ended_at` date; this is the recording policy when a session crosses midnight or a week boundary. Interrupted sessions are retained with status `interrupted` but excluded from focus totals. A session must meet its configured duration (within a two-second request tolerance); client-provided duration totals are ignored.
- **Streaks** qualify a local day when completed task count meets the configured daily goal (default 1, stored per browser account). Current streak ends today when today qualifies, otherwise yesterday; future dates never count. Longest streak is calculated from all reliable completion dates currently available. The heatmap colors reflect the daily goal and activity count.
- **Timezone and daylight saving:** task and focus timestamps are stored as UTC ISO instants. The selected IANA timezone determines local-day and local-week boundaries, so daylight-saving days may be 23 or 25 hours without shifting the calendar date. Due dates are stored as `YYYY-MM-DD` local dates.

Only the existing access JWT can read analytics or manage focus sessions. All analytics and session queries derive the user from that verified JWT, and task/project associations are ownership-checked. The application permits one active focus session per user; reset marks it interrupted rather than recording it as completed.

📅 Calendar & Weekly Planner

Choose **Lịch & kế hoạch** in the workspace navigation to open the calendar. Switch between **Ngày**, **Tuần**, and **Tháng**, then use the previous/next arrows or **Hôm nay** to move around. In week and month views, use the plus button on a date to create a task already planned for that day; selecting a task opens the existing edit form. On desktop, drag a task to another date to reschedule it. On touch devices or when using a keyboard, open the task and edit **Ngày lên lịch** instead.

**Hạn hoàn thành** remains the deadline. **Ngày lên lịch** is the planned calendar placement and may include a start time. Tasks without either date stay in **Việc cần sắp xếp**. Calendar filters cover completion status, category, and priority; weekly totals show completed, remaining, and overdue tasks. Planned dates are stored as the optional `scheduledAt` task field in SQLite. Existing browser task lists are imported automatically on their first authenticated sync.

🗂️ Kanban Board

Choose **Bảng Kanban** in the workspace navigation to see tasks in **Cần làm**, **Đang thực hiện**, and **Đã xong** columns. Drag a card between columns on desktop, or change its **Trạng thái** control with a keyboard or touch device. Status changes save immediately and keep the existing `completed` field synchronized. Select a card title to view and edit its details; use the card actions to delete it.

Create or edit a task to assign a managed project and comma-separated **Thẻ**. The board can combine project, tag, priority, due-date, and text filters; **Xóa bộ lọc** clears active filters. Use the sort selector for priority, due date, or creation date. Overdue deadlines and high-priority work are highlighted, and the count beside each column reflects the current filtered tasks. Older tasks are safely assigned to **Cần làm** or **Đã xong** from their existing completion value.

📁 **Projects and Subtasks**

Choose **Dự án** in the workspace navigation to create, edit, archive, or open project details. Project cards show total, active, completed, and overdue task counts with a calculated progress bar. Tasks can be assigned to a project or left **Chưa phân loại**. When deleting a project with tasks, choose either **Chuyển sang chưa phân loại** or **Xóa cả công việc**; the app never deletes associated tasks without an explicit choice.

Project creation can start from the Study, Work, or Personal template. Preview its initial task plan, edit the project name and description, then create real project and task records together.

Open a task to expand its **Việc con** checklist. Add, edit, complete, reorder, or delete subtasks; blank titles are rejected. Subtasks are limited to one level. Their completion count is displayed separately from project progress.

🧪 Testing

Run the combined repository verification (type check, lint, and tests):

node .tokenkit/tk.mjs verify --build


Check TypeScript:

npm run typecheck


Run linting:

npm run lint


Build the application:

npm run build

📦 Production

The production build is generated in the dist/ directory.

npm run build
npm run preview

🤝 Contributing
Create a feature branch.
Implement your changes.
Run tests and code-quality checks.
Submit a pull request.
📄 License

This project is available under the MIT License unless otherwise specified.

Built with ❤️ using React and TypeScript.