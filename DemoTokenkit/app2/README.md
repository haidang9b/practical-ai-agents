Todo App

A modern, minimalist Todo application built with React, TypeScript, Vite, and Tailwind CSS.

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
🚀 Getting Started
Prerequisites
Node.js (LTS recommended)
npm
Installation
git clone <your-repository-url>
cd <your-project-folder>
npm install

Run Development Server
npm run dev


Open the local URL shown in your terminal.

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

Data persists after refreshing the page.
Data is stored locally in the current browser.
Data is not synchronized across devices.
Clearing browser storage may permanently delete saved tasks.

No backend or authentication is required.

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