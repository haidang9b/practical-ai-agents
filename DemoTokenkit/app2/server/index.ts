import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { createDatabase } from './database';

const production = process.env.NODE_ENV === 'production';
const accessSecret = process.env.ACCESS_TOKEN_SECRET;
const refreshSecret = process.env.REFRESH_TOKEN_SECRET;

if (production && (!accessSecret || !refreshSecret || accessSecret.length < 32 || refreshSecret.length < 32 || accessSecret === refreshSecret)) {
  throw new Error('Production requires distinct ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET values of at least 32 characters.');
}

const databasePath = process.env.DATABASE_PATH ?? path.resolve('data/auth.sqlite');
const database = createDatabase(databasePath);
const app = createApp({
  database,
  accessSecret: accessSecret ?? 'development-access-secret-change-before-deploy-1',
  refreshSecret: refreshSecret ?? 'development-refresh-secret-change-before-deploy-2',
  secureCookies: production,
});

if (production) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const clientPath = path.resolve(root, '../dist');
  app.use(express.static(clientPath));
  app.get('*', (_request, response) => response.sendFile(path.join(clientPath, 'index.html')));
}

const port = Number(process.env.PORT ?? 3002);
app.listen(port, () => console.log(`Auth API listening on http://localhost:${port}`));