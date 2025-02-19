// Import necessary modules
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('./database');
const fs = require('fs');

const app = express();

// Configure EJS and middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

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

// Admin routes
app.get('/admin', (req, res) => {
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
app.post('/admin/add-gallery', upload.array('galleryImages', 50), (req, res) => {
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
app.post('/admin/add-blog', upload.single('blogImage'), (req, res) => {
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
app.post('/admin/delete-gallery/:id', (req, res) => {
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
app.post('/admin/delete-blog/:id', (req, res) => {
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});