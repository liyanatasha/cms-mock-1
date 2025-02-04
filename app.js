// Import necessary modules
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('./database');
const fs = require('fs');

const app = express();  // Initialize the Express application

// Configure EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configure file upload storage using multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');  // Directory to store uploaded files
  },
  filename: (req, file, cb) => {
    const uniqueName = uuidv4() + path.extname(file.originalname);  // Unique file names
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

// Create the uploads directory if it doesn't exist
if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', { recursive: true });
}

// Admin route for adding gallery
app.get('/admin/add-gallery', (req, res) => {
  // Fetch all galleries from the database
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

    // Process images into an array
    galleries = galleries.map(gallery => ({
      ...gallery,
      images: gallery.images ? gallery.images.split(',') : []
    }));

    // Render the add-gallery page and pass the galleries data
    res.render('admin/add-gallery', { galleries });
  });
});

// Handle gallery form submission
app.post('/admin/add-gallery', upload.array('galleryImages', 10), (req, res) => {
  const { title, description } = req.body;
  const files = req.files;

  // Start database transaction
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // Insert gallery entry into the database
    db.run(
      'INSERT INTO galleries (title, description) VALUES (?, ?)',
      [title, description],
      function(err) {
        if (err) {
          db.run('ROLLBACK');
          throw err;
        }

        const galleryId = this.lastID;

        // Insert images related to the gallery
        const stmt = db.prepare('INSERT INTO gallery_images (gallery_id, filename) VALUES (?, ?)');
        files.forEach(file => {
          stmt.run(galleryId, file.filename);
        });
        stmt.finalize();

        db.run('COMMIT');
        res.redirect('/gallery');  // Redirect to the gallery page after successful upload
      }
    );
  });
});

// Gallery viewing route
app.get('/gallery', (req, res) => {
  db.all(`
    SELECT galleries.*, GROUP_CONCAT(gallery_images.filename) AS images
    FROM galleries
    LEFT JOIN gallery_images ON galleries.id = gallery_images.gallery_id
    GROUP BY galleries.id
    ORDER BY created_at DESC
  `, (err, galleries) => {
    if (err) throw err;

    // Process images into an array
    galleries = galleries.map(gallery => ({
      ...gallery,
      images: gallery.images ? gallery.images.split(',') : []
    }));

    res.render('gallery', { galleries });  // Render gallery view
  });
});

// Landing page route
app.get('/', (req, res) => {
  res.render('index');  // Render the landing page
});

// About Us route
app.get('/about', (req, res) => {
  res.render('about');  // Render the About Us page
});

// Services route
app.get('/services', (req, res) => {
  res.render('services');  // Render the Services page
});

// Contact Us route
app.get('/contact', (req, res) => {
  res.render('contact');  // Render the Contact Us page
});

// Admin route to delete gallery
app.post('/admin/delete-gallery/:id', (req, res) => {
  const galleryId = req.params.id;

  // Start database transaction
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // Delete images associated with the gallery
    db.run('DELETE FROM gallery_images WHERE gallery_id = ?', [galleryId], function(err) {
      if (err) {
        db.run('ROLLBACK');
        throw err;
      }

      // Delete the gallery entry
      db.run('DELETE FROM galleries WHERE id = ?', [galleryId], function(err) {
        if (err) {
          db.run('ROLLBACK');
          throw err;
        }

        db.run('COMMIT');
        res.redirect('/admin/add-gallery');  // Redirect back to the gallery page after deletion
      });
    });
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Serve static files from public directory
app.use(express.static('public'));