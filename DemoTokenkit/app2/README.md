Todo App

A modern, minimalist Todo application built with React, TypeScript, Vite, and Tailwind CSS.

Express powers the authentication API. User accounts and refresh sessions are stored in SQLite.

✨ Features
✅ Create, edit, delete, and complete tasks
📝 Add descriptions, priorities, categories, and due dates
🔍 Search, filter, and sort tasks
📊 Dashboard with task statistics
🌙 Light and dark themes
💾 Automatic localStorage persistence
📱 Responsive design for desktop and mobile
🇻🇳 Vietnamese user interface
🛠️ Tech Stack
React
TypeScript
Vite
Tailwind CSS
Lucide React
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

The client runs at the Vite URL shown in the terminal and proxies `/api` to Express on port 3002. Create an account from the login screen. The SQLite database is created at `data/auth.sqlite`. Set distinct random `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` values in `.env`; keep that file private.

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
├── app/
├── components/
│   ├── common/
│   ├── dashboard/
│   ├── layout/
│   └── tasks/
├── hooks/
├── lib/
├── styles/
├── types/
└── main.tsx
tests/
README.md
package.json
vite.config.ts

💾 Data Storage

Tasks and theme preferences are saved in browser localStorage.

Todo lists are namespaced by account on the current browser and are not synchronized across devices. Passwords are hashed with bcrypt. Access JWTs expire after 15 minutes and stay in browser memory. Refresh JWTs expire after 7 days, use an HttpOnly, SameSite=Strict cookie, and rotate on refresh. Only hashes of refresh tokens are stored in SQLite. Logout revokes the current refresh session. Production requires both JWT secrets and uses Secure cookies; serve over HTTPS.

Data persists after refreshing the page.
Data is stored locally in the current browser.
Data is not synchronized across devices.
Clearing browser storage may permanently delete saved tasks.

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