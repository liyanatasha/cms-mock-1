// Import necessary modules
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { db, generateRecoveryCode } = require('./database');
const crypto = require('crypto');
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const app = express();

// Configure EJS and middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Add session middleware
app.use(session({
    secret: 'your-secret-key', // Change this to a random string in production
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));



// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueName = uuidv4() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb('Error: Images only!');
    }
});

// Ensure uploads directory exists
if (!fs.existsSync('public/uploads')) {
    fs.mkdirSync('public/uploads', { recursive: true });
}

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    console.log('Checking authentication:', {
        sessionExists: !!req.session,
        isAuthenticated: req.session?.isAuthenticated,
        sessionID: req.sessionID
    });

    if (req.session && req.session.isAuthenticated) {
        console.log('Authentication successful');
        next();
    } else {
        console.log('Authentication failed, redirecting to login');
        res.redirect('/admin/login');
    }
};
// Add before your routes
app.set('trust proxy', 1);

app.use(session({
    secret: sessionSecret,
    resave: true,           // Changed to true to ensure session is saved
    saveUninitialized: false,
    cookie: {
        secure: false,      // Set to false initially for testing
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
    name: 'sessionId'       // Changed from default connect.sid
}));
// Main routes
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/about', (req, res) => {
    res.render('about');
});

app.get('/services', (req, res) => {
    res.render('services');
});

app.get('/contact', (req, res) => {
    res.render('contact');
});

// Gallery routes
app.get('/gallery', (req, res) => {
    db.all(`
        SELECT galleries.*, GROUP_CONCAT(gallery_images.filename) AS images
        FROM galleries
        LEFT JOIN gallery_images ON galleries.id = gallery_images.gallery_id
        GROUP BY galleries.id
        ORDER BY created_at DESC
    `, (err, galleries) => {
        if (err) throw err;

        galleries = galleries.map(gallery => ({
            ...gallery,
            images: gallery.images ? gallery.images.split(',') : []
        }));

        res.render('gallery', { galleries });
    });
});

// Blog routes
app.get('/blog', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const postsPerPage = 6;
    const offset = (page - 1) * postsPerPage;

    db.get('SELECT COUNT(*) as count FROM blog_posts', [], (err, row) => {
        if (err) throw err;
        
        const totalPosts = row.count;
        const totalPages = Math.ceil(totalPosts / postsPerPage);

        db.all(`
            SELECT 
                blog_posts.*,
                GROUP_CONCAT(blog_tags.tag_name) as tags
            FROM blog_posts
            LEFT JOIN post_tags ON blog_posts.id = post_tags.post_id
            LEFT JOIN blog_tags ON post_tags.tag_id = blog_tags.id
            GROUP BY blog_posts.id
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `, [postsPerPage, offset], (err, posts) => {
            if (err) throw err;

            const blogPosts = posts.map(post => ({
                ...post,
                tags: post.tags ? post.tags.split(',') : []
            }));

            res.render('blog', {
                blogPosts,
                currentPage: page,
                totalPages
            });
        });
    });
});

app.get('/blog/:slug', (req, res) => {
    db.get(`
        SELECT 
            blog_posts.*,
            GROUP_CONCAT(blog_tags.tag_name) as tags
        FROM blog_posts
        LEFT JOIN post_tags ON blog_posts.id = post_tags.post_id
        LEFT JOIN blog_tags ON post_tags.tag_id = blog_tags.id
        WHERE blog_posts.slug = ?
        GROUP BY blog_posts.id
    `, [req.params.slug], (err, post) => {
        if (err) throw err;
        if (!post) return res.status(404).send('Post not found');

        post.tags = post.tags ? post.tags.split(',') : [];
        res.render('blog-post', { post });
    });
});

// Auth routes
// Auth routes
// Auth routes
app.get('/admin/login', (req, res) => {
    res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
    console.log('Login attempt:', { username: req.body.username });
    const { username, password } = req.body;

    db.get('SELECT * FROM admin WHERE username = ?', [username], (err, user) => {
        if (err) {
            return res.render('admin/login', { error: 'An error occurred' });
        }

        if (!user) {
            return res.render('admin/login', { error: 'Invalid credentials' });
        }

        bcrypt.compare(password, user.password, (err, match) => {
            if (err || !match) {
                return res.render('admin/login', { error: 'Invalid credentials' });
            }

            req.session.isAuthenticated = true;
            console.log('Login successful, setting session:', req.session);
            
            // Save session explicitly
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.render('admin/login', { error: 'Session error occurred' });
                }
                console.log('Session saved successfully:', req.session);
                res.redirect('/admin');
            });
        });
    });
});

app.get('/admin/recovery', (req, res) => {
    res.render('admin/reset-password', { showPasswordFields: false });
});

app.post('/admin/recovery', (req, res) => {
    const { recoveryCode, newPassword, confirmPassword } = req.body;

    // If only recovery code is provided (first step)
    if (recoveryCode && !newPassword) {
        db.get('SELECT * FROM admin WHERE id = 1', [], (err, user) => {
            if (err) {
                return res.render('admin/reset-password', { 
                    error: 'An error occurred',
                    showPasswordFields: false 
                });
            }

            // Check both recovery codes
            bcrypt.compare(recoveryCode, user.recovery_code1, (err, match1) => {
                bcrypt.compare(recoveryCode, user.recovery_code2, (err, match2) => {
                    if (match1 || match2) {
                        // Valid recovery code, show password fields
                        return res.render('admin/reset-password', { 
                            showPasswordFields: true,
                            recoveryCode: recoveryCode
                        });
                    } else {
                        return res.render('admin/reset-password', { 
                            error: 'Invalid recovery code',
                            showPasswordFields: false 
                        });
                    }
                });
            });
        });
    } 
    // If both recovery code and new password are provided (second step)
    else if (recoveryCode && newPassword && confirmPassword) {
        if (newPassword !== confirmPassword) {
            return res.render('admin/reset-password', { 
                error: 'Passwords do not match',
                showPasswordFields: true,
                recoveryCode: recoveryCode
            });
        }

        if (newPassword.length < 8) {
            return res.render('admin/reset-password', { 
                error: 'Password must be at least 8 characters long',
                showPasswordFields: true,
                recoveryCode: recoveryCode
            });
        }

        // Generate new recovery codes
        const newRecoveryCode1 = generateRecoveryCode();
        const newRecoveryCode2 = generateRecoveryCode();

        // Hash new password and recovery codes
        bcrypt.hash(newPassword, 10, (err, hashedPassword) => {
            bcrypt.hash(newRecoveryCode1, 10, (err, hashedCode1) => {
                bcrypt.hash(newRecoveryCode2, 10, (err, hashedCode2) => {
                    // Update admin record
                    db.run(`
                        UPDATE admin 
                        SET password = ?, 
                            recovery_code1 = ?, 
                            recovery_code2 = ?,
                            last_recovery_date = CURRENT_TIMESTAMP
                        WHERE id = 1
                    `, [hashedPassword, hashedCode1, hashedCode2], (err) => {
                        if (err) {
                            return res.render('admin/reset-password', { 
                                error: 'An error occurred',
                                showPasswordFields: true,
                                recoveryCode: recoveryCode
                            });
                        }

                        // Show new recovery codes
                        res.render('admin/new-recovery-codes', {
                            recoveryCode1: newRecoveryCode1,
                            recoveryCode2: newRecoveryCode2
                        });
                    });
                });
            });
        });
    }
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;

    db.get('SELECT * FROM admin WHERE username = ?', [username], (err, user) => {
        if (err) {
            return res.render('admin/login', { error: 'An error occurred' });
        }

        if (!user) {
            return res.render('admin/login', { error: 'Invalid credentials' });
        }

        bcrypt.compare(password, user.password, (err, match) => {
            if (err || !match) {
                return res.render('admin/login', { error: 'Invalid credentials' });
            }

            req.session.isAuthenticated = true;
            res.redirect('/admin');
        });
    });
});

app.get('/admin/recovery', (req, res) => {
    res.render('admin/reset-password', { showPasswordFields: false });
});

app.post('/admin/recovery', (req, res) => {
    const { recoveryCode, newPassword, confirmPassword } = req.body;

    // If only recovery code is provided (first step)
    if (recoveryCode && !newPassword) {
        db.get('SELECT * FROM admin WHERE id = 1', [], (err, user) => {
            if (err) {
                return res.render('admin/reset-password', { 
                    error: 'An error occurred',
                    showPasswordFields: false 
                });
            }

            // Check both recovery codes
            bcrypt.compare(recoveryCode, user.recovery_code1, (err, match1) => {
                bcrypt.compare(recoveryCode, user.recovery_code2, (err, match2) => {
                    if (match1 || match2) {
                        // Valid recovery code, show password fields
                        return res.render('admin/reset-password', { 
                            showPasswordFields: true,
                            recoveryCode: recoveryCode
                        });
                    } else {
                        return res.render('admin/reset-password', { 
                            error: 'Invalid recovery code',
                            showPasswordFields: false 
                        });
                    }
                });
            });
        });
    } 
    // If both recovery code and new password are provided (second step)
    else if (recoveryCode && newPassword && confirmPassword) {
        if (newPassword !== confirmPassword) {
            return res.render('admin/reset-password', { 
                error: 'Passwords do not match',
                showPasswordFields: true,
                recoveryCode: recoveryCode
            });
        }

        if (newPassword.length < 8) {
            return res.render('admin/reset-password', { 
                error: 'Password must be at least 8 characters long',
                showPasswordFields: true,
                recoveryCode: recoveryCode
            });
        }

        // Generate new recovery codes
        const newRecoveryCode1 = generateRecoveryCode();
        const newRecoveryCode2 = generateRecoveryCode();

        // Hash new password and recovery codes
        bcrypt.hash(newPassword, 10, (err, hashedPassword) => {
            bcrypt.hash(newRecoveryCode1, 10, (err, hashedCode1) => {
                bcrypt.hash(newRecoveryCode2, 10, (err, hashedCode2) => {
                    // Update admin record
                    db.run(`
                        UPDATE admin 
                        SET password = ?, 
                            recovery_code1 = ?, 
                            recovery_code2 = ?,
                            last_recovery_date = CURRENT_TIMESTAMP
                        WHERE id = 1
                    `, [hashedPassword, hashedCode1, hashedCode2], (err) => {
                        if (err) {
                            return res.render('admin/reset-password', { 
                                error: 'An error occurred',
                                showPasswordFields: true,
                                recoveryCode: recoveryCode
                            });
                        }

                        // Show new recovery codes
                        res.render('admin/new-recovery-codes', {
                            recoveryCode1: newRecoveryCode1,
                            recoveryCode2: newRecoveryCode2
                        });
                    });
                });
            });
        });
    }
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;

    db.get('SELECT * FROM admin WHERE username = ?', [username], (err, user) => {
        if (err) {
            return res.render('admin/login', { error: 'An error occurred' });
        }

        if (!user) {
            return res.render('admin/login', { error: 'Invalid credentials' });
        }

        bcrypt.compare(password, user.password, (err, match) => {
            if (err || !match) {
                return res.render('admin/login', { error: 'Invalid credentials' });
            }

            req.session.isAuthenticated = true;
            res.redirect('/admin');
        });
    });
});

app.get('/admin/recovery', (req, res) => {
    res.render('admin/reset-password', { showPasswordFields: false });
});

app.post('/admin/recovery', (req, res) => {
    const { recoveryCode, newPassword, confirmPassword } = req.body;

    // If only recovery code is provided (first step)
    if (recoveryCode && !newPassword) {
        db.get('SELECT * FROM admin', [], (err, user) => {
            if (err) {
                return res.render('admin/reset-password', { 
                    error: 'An error occurred',
                    showPasswordFields: false 
                });
            }

            // Check both recovery codes
            bcrypt.compare(recoveryCode, user.recovery_code1, (err, match1) => {
                bcrypt.compare(recoveryCode, user.recovery_code2, (err, match2) => {
                    if (match1 || match2) {
                        // Valid recovery code, show password fields
                        return res.render('admin/reset-password', { 
                            showPasswordFields: true,
                            recoveryCode: recoveryCode // Pass the code to the next step
                        });
                    } else {
                        return res.render('admin/reset-password', { 
                            error: 'Invalid recovery code',
                            showPasswordFields: false 
                        });
                    }
                });
            });
        });
    } 
    // If both recovery code and new password are provided (second step)
    else if (recoveryCode && newPassword && confirmPassword) {
        if (newPassword !== confirmPassword) {
            return res.render('admin/reset-password', { 
                error: 'Passwords do not match',
                showPasswordFields: true,
                recoveryCode: recoveryCode
            });
        }

        if (newPassword.length < 8) {
            return res.render('admin/reset-password', { 
                error: 'Password must be at least 8 characters long',
                showPasswordFields: true,
                recoveryCode: recoveryCode
            });
        }

        // Generate new recovery codes
        const newRecoveryCode1 = generateRecoveryCode();
        const newRecoveryCode2 = generateRecoveryCode();

        // Hash new password and recovery codes
        bcrypt.hash(newPassword, 10, (err, hashedPassword) => {
            bcrypt.hash(newRecoveryCode1, 10, (err, hashedCode1) => {
                bcrypt.hash(newRecoveryCode2, 10, (err, hashedCode2) => {
                    // Update admin record
                    db.run(`
                        UPDATE admin 
                        SET password = ?, 
                            recovery_code1 = ?, 
                            recovery_code2 = ?,
                            last_recovery_date = CURRENT_TIMESTAMP
                        WHERE id = 1
                    `, [hashedPassword, hashedCode1, hashedCode2], (err) => {
                        if (err) {
                            return res.render('admin/reset-password', { 
                                error: 'An error occurred',
                                showPasswordFields: true,
                                recoveryCode: recoveryCode
                            });
                        }

                        // Show new recovery codes
                        res.render('admin/new-recovery-codes', {
                            recoveryCode1: newRecoveryCode1,
                            recoveryCode2: newRecoveryCode2
                        });
                    });
                });
            });
        });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Admin routes (protected)
app.get('/admin', isAuthenticated, (req, res) => {
    // Fetch galleries
    db.all(`
        SELECT galleries.*, GROUP_CONCAT(gallery_images.filename) AS images
        FROM galleries
        LEFT JOIN gallery_images ON galleries.id = gallery_images.gallery_id
        GROUP BY galleries.id
        ORDER BY created_at DESC
    `, (err, galleries) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error fetching galleries');
        }

        galleries = galleries.map(gallery => ({
            ...gallery,
            images: gallery.images ? gallery.images.split(',') : []
        }));

        // Fetch blog posts
        db.all(`
            SELECT 
                blog_posts.*,
                GROUP_CONCAT(blog_tags.tag_name) as tags
            FROM blog_posts
            LEFT JOIN post_tags ON blog_posts.id = post_tags.post_id
            LEFT JOIN blog_tags ON post_tags.tag_id = blog_tags.id
            GROUP BY blog_posts.id
            ORDER BY created_at DESC
        `, (err, posts) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error fetching blog posts');
            }

            const blogPosts = posts.map(post => ({
                ...post,
                tags: post.tags ? post.tags.split(',') : []
            }));

            res.render('admin/dashboard', { galleries, blogPosts });
        });
    });
});

// Handle gallery submission
app.post('/admin/add-gallery', isAuthenticated, upload.array('galleryImages', 50), (req, res) => {
    const { title, description } = req.body;
    const files = req.files;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run(
            'INSERT INTO galleries (title, description) VALUES (?, ?)',
            [title, description],
            function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    throw err;
                }

                const galleryId = this.lastID;
                const stmt = db.prepare('INSERT INTO gallery_images (gallery_id, filename) VALUES (?, ?)');
                files.forEach(file => {
                    stmt.run(galleryId, file.filename);
                });
                stmt.finalize();

                db.run('COMMIT');
                res.redirect('/admin');
            }
        );
    });
});

// Handle blog post submission
app.post('/admin/add-blog', isAuthenticated, upload.single('blogImage'), (req, res) => {
    const { title, content, excerpt, tags } = req.body;
    const image = req.file ? req.file.filename : null;
    const slug = title.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run(`
            INSERT INTO blog_posts (title, content, excerpt, image, slug)
            VALUES (?, ?, ?, ?, ?)
        `, [title, content, excerpt, image, slug], function(err) {
            if (err) {
                db.run('ROLLBACK');
                throw err;
            }

            const postId = this.lastID;

            if (tags) {
                const tagArray = tags.split(',').map(tag => tag.trim());
                const tagStmt = db.prepare(`
                    INSERT OR IGNORE INTO blog_tags (tag_name)
                    VALUES (?)
                `);

                tagArray.forEach(tag => {
                    tagStmt.run(tag, function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            throw err;
                        }

                        db.run(`
                            INSERT INTO post_tags (post_id, tag_id)
                            SELECT ?, id FROM blog_tags WHERE tag_name = ?
                        `, [postId, tag], function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                throw err;
                            }
                        });
                    });
                });

                tagStmt.finalize();
            }

            db.run('COMMIT');
            res.redirect('/admin');
        });
    });
});

// Handle gallery deletion
app.post('/admin/delete-gallery/:id', isAuthenticated, (req, res) => {
    const galleryId = req.params.id;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Get image filenames before deleting
        db.all('SELECT filename FROM gallery_images WHERE gallery_id = ?', [galleryId], (err, images) => {
            if (err) {
                db.run('ROLLBACK');
                throw err;
            }

            // Delete from database
            db.run('DELETE FROM gallery_images WHERE gallery_id = ?', [galleryId], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    throw err;
                }

                db.run('DELETE FROM galleries WHERE id = ?', [galleryId], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        throw err;
                    }

                    // Delete image files
                    images.forEach(image => {
                        const filePath = path.join(__dirname, 'public', 'uploads', image.filename);
                        fs.unlink(filePath, (err) => {
                            if (err) console.error('Error deleting file:', err);
                        });
                    });

                    db.run('COMMIT');
                    res.redirect('/admin');
                });
            });
        });
    });
});

// Handle blog post deletion
app.post('/admin/delete-blog/:id', isAuthenticated, (req, res) => {
    const postId = req.params.id;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Get image filename before deleting
        db.get('SELECT image FROM blog_posts WHERE id = ?', [postId], (err, post) => {
            if (err) {
                db.run('ROLLBACK');
                throw err;
            }

            // Delete from database
            db.run('DELETE FROM post_tags WHERE post_id = ?', [postId], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    throw err;
                }

                db.run('DELETE FROM blog_posts WHERE id = ?', [postId], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        throw err;
                    }

                    // Delete image file if it exists
                    if (post && post.image) {
                        const filePath = path.join(__dirname, 'public', 'uploads', post.image);
                        fs.unlink(filePath, (err) => {
                            if (err) console.error('Error deleting file:', err);
                        });
                    }

                    db.run('COMMIT');
                    res.redirect('/admin');
                });
            });
        });
    });
});

// Debug route to check session status
app.get('/debug-session', (req, res) => {
    res.json({
        sessionID: req.sessionID,
        session: req.session,
        isAuthenticated: req.session?.isAuthenticated,
        cookies: req.cookies
    });
});

// Add these routes to your app.js file

// Route to get the edit gallery page
app.get('/admin/edit-gallery/:id', isAuthenticated, (req, res) => {
    const galleryId = req.params.id;
    
    db.get(`
        SELECT galleries.*, GROUP_CONCAT(gallery_images.filename) AS images
        FROM galleries
        LEFT JOIN gallery_images ON galleries.id = gallery_images.gallery_id
        WHERE galleries.id = ?
        GROUP BY galleries.id
    `, [galleryId], (err, gallery) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error fetching gallery');
        }
        
        if (!gallery) {
            return res.status(404).send('Gallery not found');
        }
        
        gallery.images = gallery.images ? gallery.images.split(',') : [];
        
        res.render('admin/edit-gallery', { gallery });
    });
});

// Route to update a gallery
app.post('/admin/update-gallery/:id', isAuthenticated, upload.array('newImages', 50), (req, res) => {
    const galleryId = req.params.id;
    const { title, description, removedImages } = req.body;
    const newFiles = req.files;
    
    // Parse the removed images array
    let imagesToRemove = [];
    if (removedImages) {
        try {
            imagesToRemove = JSON.parse(removedImages);
        } catch (e) {
            console.error('Error parsing removedImages:', e);
        }
    }
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Update gallery details
        db.run(
            'UPDATE galleries SET title = ?, description = ? WHERE id = ?',
            [title, description, galleryId],
            function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error(err);
                    return res.status(500).send('Error updating gallery');
                }
                
                // Process removed images
                if (imagesToRemove.length > 0) {
                    const placeholders = imagesToRemove.map(() => '?').join(',');
                    db.run(
                        `DELETE FROM gallery_images WHERE gallery_id = ? AND filename IN (${placeholders})`,
                        [galleryId, ...imagesToRemove],
                        function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                console.error(err);
                                return res.status(500).send('Error removing images');
                            }
                            
                            // Delete image files
                            imagesToRemove.forEach(filename => {
                                const filePath = path.join(__dirname, 'public', 'uploads', filename);
                                fs.unlink(filePath, (err) => {
                                    if (err) console.error('Error deleting file:', err);
                                });
                            });
                        }
                    );
                }
                
                // Add new images
                if (newFiles && newFiles.length > 0) {
                    const stmt = db.prepare('INSERT INTO gallery_images (gallery_id, filename) VALUES (?, ?)');
                    newFiles.forEach(file => {
                        stmt.run(galleryId, file.filename);
                    });
                    stmt.finalize();
                }
                
                db.run('COMMIT');
                res.redirect('/admin');
            }
        );
    });
});

// Route to get the edit blog post page
app.get('/admin/edit-blog/:id', isAuthenticated, (req, res) => {
    const postId = req.params.id;
    
    db.get(`
        SELECT 
            blog_posts.*,
            GROUP_CONCAT(blog_tags.tag_name) as tags
        FROM blog_posts
        LEFT JOIN post_tags ON blog_posts.id = post_tags.post_id
        LEFT JOIN blog_tags ON post_tags.tag_id = blog_tags.id
        WHERE blog_posts.id = ?
        GROUP BY blog_posts.id
    `, [postId], (err, post) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error fetching blog post');
        }
        
        if (!post) {
            return res.status(404).send('Blog post not found');
        }
        
        post.tags = post.tags ? post.tags.split(',') : [];
        
        res.render('admin/edit-blog', { post });
    });
});

// Route to update a blog post
app.post('/admin/update-blog/:id', isAuthenticated, upload.single('blogImage'), (req, res) => {
    const postId = req.params.id;
    const { title, content, excerpt, tags, removeFeaturedImage } = req.body;
    const newImage = req.file ? req.file.filename : null;
    
    // Generate slug from title if it has changed
    const slug = title.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // First, check if we need to remove the current featured image
        if (removeFeaturedImage === 'true') {
            db.get('SELECT image FROM blog_posts WHERE id = ?', [postId], (err, post) => {
                if (err) {
                    db.run('ROLLBACK');
                    console.error(err);
                    return res.status(500).send('Error checking current image');
                }
                
                if (post && post.image) {
                    // Delete the old image file
                    const filePath = path.join(__dirname, 'public', 'uploads', post.image);
                    fs.unlink(filePath, (err) => {
                        if (err) console.error('Error deleting file:', err);
                    });
                }
            });
        }
        
        // Update blog post details
        let updateQuery, updateParams;
        
        if (newImage) {
            // If there's a new image, update the image field
            updateQuery = `
                UPDATE blog_posts 
                SET title = ?, content = ?, excerpt = ?, image = ?, slug = ?
                WHERE id = ?
            `;
            updateParams = [title, content, excerpt, newImage, slug, postId];
        } else if (removeFeaturedImage === 'true') {
            // If featured image should be removed and no new image
            updateQuery = `
                UPDATE blog_posts 
                SET title = ?, content = ?, excerpt = ?, image = NULL, slug = ?
                WHERE id = ?
            `;
            updateParams = [title, content, excerpt, slug, postId];
        } else {
            // Just update text fields
            updateQuery = `
                UPDATE blog_posts 
                SET title = ?, content = ?, excerpt = ?, slug = ?
                WHERE id = ?
            `;
            updateParams = [title, content, excerpt, slug, postId];
        }
        
        db.run(updateQuery, updateParams, function(err) {
            if (err) {
                db.run('ROLLBACK');
                console.error(err);
                return res.status(500).send('Error updating blog post');
            }
            
            // Delete existing tag associations
            db.run('DELETE FROM post_tags WHERE post_id = ?', [postId], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error(err);
                    return res.status(500).send('Error updating tags');
                }
                
                // Process new tags if provided
                if (tags) {
                    const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag);
                    
                    if (tagArray.length > 0) {
                        const tagStmt = db.prepare(`
                            INSERT OR IGNORE INTO blog_tags (tag_name)
                            VALUES (?)
                        `);
                        
                        const processNextTag = (index) => {
                            if (index >= tagArray.length) {
                                db.run('COMMIT');
                                return res.redirect('/admin');
                            }
                            
                            const tag = tagArray[index];
                            tagStmt.run(tag, function(err) {
                                if (err) {
                                    tagStmt.finalize();
                                    db.run('ROLLBACK');
                                    console.error(err);
                                    return res.status(500).send('Error adding tag');
                                }
                                
                                db.run(`
                                    INSERT INTO post_tags (post_id, tag_id)
                                    SELECT ?, id FROM blog_tags WHERE tag_name = ?
                                `, [postId, tag], function(err) {
                                    if (err) {
                                        tagStmt.finalize();
                                        db.run('ROLLBACK');
                                        console.error(err);
                                        return res.status(500).send('Error linking tag');
                                    }
                                    
                                    processNextTag(index + 1);
                                });
                            });
                        };
                        
                        processNextTag(0);
                        tagStmt.finalize();
                    } else {
                        db.run('COMMIT');
                        res.redirect('/admin');
                    }
                } else {
                    db.run('COMMIT');
                    res.redirect('/admin');
                }
            });
        });
    });
});

// Route to handle inline image uploads for Quill editor
app.post('/admin/upload-inline-image', isAuthenticated, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Return the location of the uploaded file for Quill
    res.json({
        location: `/uploads/${req.file.filename}`
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});