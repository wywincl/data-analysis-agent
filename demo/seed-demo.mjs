#!/usr/bin/env node
/**
 * Seed the demo SQLite database (demo/demo.db): users, orders, daily_revenue
 * over six months — enough shape for trend / share / correlation questions.
 *
 *   node demo/seed-demo.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const file = join(root, 'demo', 'demo.db')
mkdirSync(dirname(file), { recursive: true })

const db = new DatabaseSync(file)
db.exec('PRAGMA journal_mode = WAL')
db.exec(`
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS daily_revenue;
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  signup_date TEXT NOT NULL
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE daily_revenue (
  dt TEXT PRIMARY KEY,
  revenue REAL NOT NULL,
  orders INTEGER NOT NULL
);
`)

const cities = ['杭州', '上海', '北京', '深圳', '成都', '武汉']
const statuses = ['paid', 'paid', 'paid', 'shipped', 'refunded', 'pending']
const users = []
const insertUser = db.prepare('INSERT INTO users (id, name, city, signup_date) VALUES (?, ?, ?, ?)')
for (let id = 1; id <= 120; id++) {
  const city = cities[id % cities.length]
  const signup = new Date(Date.UTC(2026, 0, 1 + (id * 2) % 210)).toISOString().slice(0, 10)
  insertUser.run(id, `用户${String(id).padStart(3, '0')}`, city, signup)
  users.push({ id, city, signup })
}

const insertOrder = db.prepare('INSERT INTO orders (id, user_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)')
const revenue = new Map()
for (let id = 1; id <= 800; id++) {
  const user = users[id % users.length]
  const day = new Date(Date.UTC(2026, 2, 1) + Math.floor((id / 800) * 170) * 86_400_000)
  const created = day.toISOString().slice(0, 10)
  const amount = Math.round((50 + 400 * Math.abs(Math.sin(id * 1.7)) + (user.city === '上海' ? 120 : 0)) * 100) / 100
  const status = statuses[id % statuses.length]
  insertOrder.run(id, user.id, amount, status, created)
  if (status === 'paid') {
    const entry = revenue.get(created) ?? { revenue: 0, orders: 0 }
    entry.revenue = Math.round((entry.revenue + amount) * 100) / 100
    entry.orders += 1
    revenue.set(created, entry)
  }
}

const insertRevenue = db.prepare('INSERT INTO daily_revenue (dt, revenue, orders) VALUES (?, ?, ?)')
for (const [dt, entry] of [...revenue.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  insertRevenue.run(dt, entry.revenue, entry.orders)
}

console.log(`seeded ${file}: ${users.length} users, 800 orders, ${revenue.size} revenue days`)
db.close()
