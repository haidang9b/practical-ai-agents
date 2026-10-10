Todo App

A modern, minimalist Todo application built with React, TypeScript, Vite, Tailwind CSS, and Express.

✨ Features
✅ Create, edit, delete, and complete tasks
📝 Add descriptions, priorities, categories, and due dates
🔍 Search, filter, and sort tasks
📊 Dashboard with task statistics
🌙 Light and dark themes
💾 Account-owned SQLite persistence
📱 Responsive design for desktop and mobile
🇻🇳 Vietnamese user interface
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

Run Development Server
npm run dev


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
npm run lint	Check code quality
npm run typecheck	Check TypeScript types
📁 Project Structure
src/
├── App.tsx
├── components/
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
├── index.js
└── tokens.js
scripts/
└── test-api.mjs
index.html
package.json
vite.config.ts
tailwind.config.js

💾 Data Storage

Theme preferences are saved in browser localStorage. Accounts and tasks are stored in SQLite on the Express server.

Data persists after refreshing the page.
Passwords are stored as bcrypt hashes. Access JWTs expire after 10 minutes and stay in frontend memory. Refresh JWTs expire after 7 days, are rotated on use, and are sent in an HttpOnly, SameSite=Strict cookie.
Refresh tokens are stored server-side only as SHA-256 hashes; reusing a rotated token revokes that token family.
Use `npm run test:api` while the development server is running to exercise login, refresh, logout, and per-user task APIs.

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