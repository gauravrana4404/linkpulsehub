require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 10000;

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));
// Replace your current allowedOrigins and CORS setup with this:

const allowedOrigins = [
  'https://nxp-backend1.onrender.com/', // Your frontend URL
  'https://nxp-backend.onrender.com/',  // Your backend URL
  'http://localhost:10000',             // Local development
  'http://localhost:3000'               // Common frontend dev port
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Define Schemas
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  tokens: [{
    token: String
  }],
  createdAt: { type: Date, default: Date.now }
});

UserSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 8);
  }
  next();
});

UserSchema.methods.generateAuthToken = async function () {
  const token = jwt.sign({ id: this._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
  this.tokens = this.tokens.concat({ token });
  await this.save();
  return token;
};

const SiteSchema = new mongoose.Schema({
  name: String,
  domain: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});

const BacklinkSchema = new mongoose.Schema({
  url: { type: String, unique: true },
  spamScore: { type: Number, default: 0 },
  isLive: { type: Boolean, default: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  site: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Site = mongoose.model('Site', SiteSchema);
const Backlink = mongoose.model('Backlink', BacklinkSchema);

// Initialize Sites
const initializeSites = async () => {
  const sites = [
    { name: 'Mushroom Maestro', domain: 'mushroommaestro.com' },
    { name: 'Health11 News', domain: 'health11news.com' },
    { name: 'NootropicsPlanet', domain: 'nootropicsplanet.com' }
  ];
  
  for (const site of sites) {
    await Site.findOneAndUpdate(
      { domain: site.domain },
      site,
      { upsert: true, new: true }
    );
  }
  console.log('Sites initialized');
};

mongoose.connection.once('open', initializeSites);

// Middleware
app.use(cors());
app.use(express.json());
// Add this before your routes
app.options('*', cors()); // Handle preflight requests

// Serve static files
app.use(express.static('public'));

// Auth Middleware
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) throw new Error();
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ _id: decoded.id, 'tokens.token': token });

    if (!user) {
      throw new Error();
    }

    req.token = token;
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ msg: 'Please authenticate' });
  }
};

// Utility Functions
const getSpamScore = async (url) => {
  return Math.floor(Math.random() * 100);
};

const checkUrlStatus = async (url) => {
  return Math.random() > 0.2;
};

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ msg: 'User already exists' });

    user = new User({ name, email, password });
    await user.save();
    const token = await user.generateAuthToken();
    res.status(201).json({ user, token });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

    const token = await user.generateAuthToken();
    res.json({ user, token });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', auth, async (req, res) => {
  try {
    req.user.tokens = req.user.tokens.filter(token => token.token !== req.token);
    await req.user.save();
    res.json({ msg: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/user', auth, async (req, res) => {
  res.json(req.user);
});

// Backlink Routes
app.post('/api/backlinks', auth, async (req, res) => {
  try {
    const { url, siteId } = req.body;
    const site = await Site.findById(siteId);
    if (!site) return res.status(404).json({ msg: 'Site not found' });
    
    const existing = await Backlink.findOne({ url });
    if (existing) return res.status(400).json({ msg: 'URL already exists' });
    
    const isLive = await checkUrlStatus(url);
    const spamScore = await getSpamScore(url);
    
    const newBacklink = new Backlink({
      url,
      spamScore,
      isLive,
      user: req.user.id,
      site: siteId
    });
    
    await newBacklink.save();
    res.json(newBacklink);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/backlinks', auth, async (req, res) => {
  try {
    const backlinks = await Backlink.find({ user: req.user.id })
      .populate('site', 'name domain')
      .sort({ createdAt: -1 });
    res.json(backlinks);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Excel Upload Route
app.post('/api/backlinks/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ msg: 'No file uploaded' });

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    if (!data.length) return res.status(400).json({ msg: 'Excel file is empty' });

    const results = [];
    const errors = [];

    for (const [index, row] of data.entries()) {
      const url = row.URL || row.url;
      const domain = row['Site Domain'] || row.domain || row['Site domain'];
      
      if (!url || !domain) {
        errors.push({ row: index+1, msg: 'Missing URL or Site Domain' });
        continue;
      }

      try {
        const site = await Site.findOne({ domain });
        if (!site) {
          errors.push({ row: index+1, msg: `Site ${domain} not found` });
          continue;
        }

        const existing = await Backlink.findOne({ url });
        if (existing) {
          errors.push({ row: index+1, msg: 'URL already exists' });
          continue;
        }

        const isLive = await checkUrlStatus(url);
        const spamScore = await getSpamScore(url);

        const newBacklink = new Backlink({
          url,
          spamScore,
          isLive,
          user: req.user.id,
          site: site._id
        });

        await newBacklink.save();
        results.push(newBacklink);
      } catch (err) {
        errors.push({ row: index+1, msg: err.message });
      }
    }

    res.json({
      msg: `Processed ${data.length} rows`,
      success: results.length,
      errors: errors.length,
      errorDetails: errors
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
// Site Routes
app.get('/api/sites', async (req, res) => {
  try {
    const sites = await Site.find();
    res.json(sites);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
