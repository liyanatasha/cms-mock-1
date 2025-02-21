const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

// Helper function to generate recovery code
function generateRecoveryCode() {
    const length = 16;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        if (i > 0 && i % 4 === 0) result += '-';
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Initialize database connection
console.log('Initializing database...');
const dbPath = path.join(__dirname, 'cms.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
        return;
    }
    console.log('Connected to the CMS database.');
    
    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON');
});

// Create tables and initialize admin account
function initializeDatabase() {
    console.log('Starting database initialization...');
    
    // Create admin table first
    db.run(`CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        recovery_code1 TEXT,
        recovery_code2 TEXT,
        last_recovery_date DATETIME
    )`, (err) => {
        if (err) {
            console.error('Error creating admin table:', err.message);
            return;
        }
        console.log('Admin table created or already exists');

        // Check if admin account exists
        db.get("SELECT * FROM admin WHERE username = 'admin'", [], (err, row) => {
            if (err) {
                console.error('Error checking admin account:', err.message);
                return;
            }
            
            if (!row) {
                console.log('No admin account found, creating default account...');
                
                // Generate initial recovery codes
                const recoveryCode1 = generateRecoveryCode();
                const recoveryCode2 = generateRecoveryCode();
                
                // Create default admin account
                bcrypt.hash('admin123', 10, (err, hashedPassword) => {
                    if (err) {
                        console.error('Error hashing password:', err.message);
                        return;
                    }

                    // Hash recovery codes
                    bcrypt.hash(recoveryCode1, 10, (err, hashedCode1) => {
                        if (err) {
                            console.error('Error hashing recovery code 1:', err.message);
                            return;
                        }

                        bcrypt.hash(recoveryCode2, 10, (err, hashedCode2) => {
                            if (err) {
                                console.error('Error hashing recovery code 2:', err.message);
                                return;
                            }

                            db.run(`INSERT INTO admin (username, password, recovery_code1, recovery_code2) 
                                   VALUES (?, ?, ?, ?)`,
                                ['admin', hashedPassword, hashedCode1, hashedCode2],
                                (err) => {
                                    if (err) {
                                        console.error('Error creating admin account:', err.message);
                                    } else {
                                        console.log('=======================================');
                                        console.log('Default admin account created:');
                                        console.log('Username: admin');
                                        console.log('Password: admin123');
                                        console.log('Recovery Code 1:', recoveryCode1);
                                        console.log('Recovery Code 2:', recoveryCode2);
                                        console.log('IMPORTANT: Save these recovery codes and');
                                        console.log('change the password immediately!');
                                        console.log('=======================================');
                                    }
                                }
                            );
                        });
                    });
                });
            } else {
                console.log('Admin account already exists');
            }
        });
    });

    // Create other tables
    const createTables = [
        `CREATE TABLE IF NOT EXISTS galleries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS gallery_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gallery_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            FOREIGN KEY(gallery_id) REFERENCES galleries(id)
        )`,
        `CREATE TABLE IF NOT EXISTS blog_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            excerpt TEXT,
            image TEXT,
            slug TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS blog_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_name TEXT UNIQUE NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS post_tags (
            post_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (post_id, tag_id),
            FOREIGN KEY(post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
            FOREIGN KEY(tag_id) REFERENCES blog_tags(id) ON DELETE CASCADE
        )`
    ];

    createTables.forEach((sql, index) => {
        db.run(sql, (err) => {
            if (err) {
                console.error(`Error creating table ${index + 1}:`, err.message);
            } else {
                console.log(`Table ${index + 1} created or already exists`);
            }
        });
    });
}

// Initialize the database
initializeDatabase();

module.exports = {
    db,
    generateRecoveryCode
};