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

// Admin routes for adding gallery entries
app.get('/admin/add-gallery', (req, res) => {
  res.render('admin/add-gallery');  // Render form to add gallery
});

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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
