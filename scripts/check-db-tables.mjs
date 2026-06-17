import Database from 'better-sqlite3'

for (const p of ['prisma/dev.db', 'dev.db']) {
  try {
    const db = new Database(p)
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Zatca%'").all()
    console.log(p, rows)
  } catch (e) {
    console.log(p, e.message)
  }
}
