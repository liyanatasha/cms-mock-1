const sqlite3 = require('sqlite3').verbose();

// Initialize database connection
const db = new sqlite3.Database('./cms.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the CMS database.');
});

// Create tables if not exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS galleries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS gallery_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gallery_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        FOREIGN KEY(gallery_id) REFERENCES galleries(id)
    )`);
});

module.exports = db;
