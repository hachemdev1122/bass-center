const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const path = require('path');

let db;
let dbInitialized = false;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const config = require('./config.json');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

async function ensureDb() {
  if (dbInitialized && db) return;
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, price REAL NOT NULL, original_price REAL, image TEXT, category TEXT DEFAULT 'mobiles', stock INTEGER DEFAULT 0, featured INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, phone TEXT NOT NULL, governorate TEXT NOT NULL, address_detail TEXT, product_id INTEGER, product_name TEXT, quantity INTEGER DEFAULT 1, total_price REAL, status TEXT DEFAULT 'pending', notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  dbInitialized = true;
}

function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token === config.admin_password) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function runQuery(sql, params = []) {
  db.run(sql, params);
}

function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
  stmt.free();
  return null;
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) { rows.push(stmt.getAsObject()); }
  stmt.free();
  return rows;
}

function getLastInsertId() {
  const row = getOne('SELECT last_insert_rowid() as id');
  return row ? row.id : null;
}

async function sendTelegramNotification(message) {
  const rows = getAll('SELECT * FROM settings');
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  const token = settings.telegram_bot_token || config.telegram_bot_token;
  const chatIdStr = settings.telegram_chat_id || config.telegram_chat_id;
  if (!token || token === 'YOUR_BOT_TOKEN_HERE' || !chatIdStr) return;
  const chatIds = chatIdStr.split(',').map(id => id.trim()).filter(id => id);
  try {
    const fetch = (await import('node-fetch')).default;
    for (const chatId of chatIds) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
      });
    }
  } catch (err) { console.error('Telegram error:', err.message); }
}

app.get('/api/products', async (req, res) => {
  await ensureDb();
  const { category, search, featured } = req.query;
  let query = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (category) { query += ' AND category = ?'; params.push(category); }
  if (search) { query += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (featured === '1') { query += ' AND featured = 1'; }
  query += ' ORDER BY created_at DESC';
  res.json(getAll(query, params));
});

app.get('/api/products/:id', async (req, res) => {
  await ensureDb();
  const product = getOne('SELECT * FROM products WHERE id = ?', [parseInt(req.params.id)]);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

app.post('/api/orders', async (req, res) => {
  await ensureDb();
  const { customer_name, phone, governorate, address_detail, product_id, quantity, notes } = req.body;
  if (!customer_name || !phone || !governorate || !product_id) {
    return res.status(400).json({ error: 'All required fields must be filled' });
  }
  const product = getOne('SELECT * FROM products WHERE id = ?', [parseInt(product_id)]);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const qty = quantity || 1;
  const total = product.price * qty;
  runQuery('INSERT INTO orders (customer_name, phone, governorate, address_detail, product_id, product_name, quantity, total_price, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [customer_name, phone, governorate, address_detail || '', parseInt(product_id), product.name, parseInt(qty), total, notes || '']);
  const orderId = getLastInsertId();
  runQuery('UPDATE products SET stock = stock - ? WHERE id = ?', [parseInt(qty), parseInt(product_id)]);
  const order = getOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  const rows2 = getAll('SELECT * FROM settings');
  const settingsMap = {};
  rows2.forEach(r => { settingsMap[r.key] = r.value; });
  const storeName = settingsMap.store_name || config.store_name;
  const telegramMsg = [`🛒 <b>طلب جديد - ${storeName}</b>`, `━━━━━━━━━━━━━━━━━━━━`, ``, `👤 <b>العميل:</b> ${customer_name}`, `📱 <b>الهاتف:</b> ${phone}`, `📍 <b>المحافظة:</b> ${governorate}`, `🏠 <b>العنوان:</b> ${address_detail || 'غير محدد'}`, ``, `━━━━━━━━━━━━━━━━━━━━`, `📦 <b>المنتج:</b> ${product.name}`, `🔢 <b>الكمية:</b> ${qty}`, `💰 <b>السعر:</b> ${total.toLocaleString('ar-IQ')} د.ع`, ``, `📝 <b>ملاحظات:</b> ${notes || 'لا يوجد'}`, ``, `━━━━━━━━━━━━━━━━━━━━`, `📋 <b>رقم الطلب:</b> #${orderId}`, `⏰ ${new Date().toLocaleString('ar-IQ')}`].join('\n');
  sendTelegramNotification(telegramMsg);
  res.json({ success: true, order });
});

app.get('/api/admin/products', authMiddleware, async (req, res) => {
  await ensureDb();
  res.json(getAll('SELECT * FROM products ORDER BY created_at DESC'));
});

app.post('/api/admin/products', authMiddleware, upload.single('image'), async (req, res) => {
  await ensureDb();
  const { name, description, price, original_price, category, stock, featured } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price are required' });
  let image = '';
  if (req.file) {
    image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  } else if (req.body.image) {
    image = req.body.image;
  }
  runQuery('INSERT INTO products (name, description, price, original_price, image, category, stock, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [name, description || '', parseFloat(price), original_price ? parseFloat(original_price) : null, image, category || 'mobiles', parseInt(stock) || 0, featured === 'true' || featured === '1' ? 1 : 0]);
  res.json({ success: true, id: getLastInsertId() });
});

app.put('/api/admin/products/:id', authMiddleware, upload.single('image'), async (req, res) => {
  await ensureDb();
  const existing = getOne('SELECT * FROM products WHERE id = ?', [parseInt(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const { name, description, price, original_price, category, stock, featured } = req.body;
  let image = existing.image;
  if (req.file) {
    image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  } else if (req.body.image !== undefined) {
    image = req.body.image;
  }
  runQuery('UPDATE products SET name=?, description=?, price=?, original_price=?, image=?, category=?, stock=?, featured=? WHERE id=?',
    [name || existing.name, description !== undefined ? description : existing.description, price ? parseFloat(price) : existing.price, original_price !== undefined ? (original_price ? parseFloat(original_price) : null) : existing.original_price, image, category || existing.category, stock !== undefined ? parseInt(stock) : existing.stock, featured !== undefined ? (featured === 'true' || featured === '1' ? 1 : 0) : existing.featured, parseInt(req.params.id)]);
  res.json({ success: true });
});

app.delete('/api/admin/products/:id', authMiddleware, async (req, res) => {
  await ensureDb();
  const product = getOne('SELECT * FROM products WHERE id = ?', [parseInt(req.params.id)]);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  runQuery('DELETE FROM products WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ success: true });
});

app.get('/api/admin/orders', authMiddleware, async (req, res) => {
  await ensureDb();
  const { status } = req.query;
  let query = 'SELECT * FROM orders';
  const params = [];
  if (status) { query += ' WHERE status = ?'; params.push(status); }
  query += ' ORDER BY created_at DESC';
  res.json(getAll(query, params));
});

app.put('/api/admin/orders/:id', authMiddleware, async (req, res) => {
  await ensureDb();
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  runQuery('UPDATE orders SET status = ? WHERE id = ?', [status, parseInt(req.params.id)]);
  const order = getOne('SELECT * FROM orders WHERE id = ?', [parseInt(req.params.id)]);
  if (order) {
    const statusLabels = { pending: 'قيد الانتظار', confirmed: 'تم التأكيد', shipped: 'تم الشحن', delivered: 'تم التوصيل', cancelled: 'ملغي' };
    sendTelegramNotification(`📊 تحديث الطلب #${order.id}\nالعميل: ${order.customer_name}\nالحالة: ${statusLabels[status]}`);
  }
  res.json({ success: true });
});

app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  await ensureDb();
  const totalProducts = getOne('SELECT COUNT(*) as count FROM products').count;
  const totalOrders = getOne('SELECT COUNT(*) as count FROM orders').count;
  const pendingOrders = getOne("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").count;
  const totalRevenue = getOne("SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status != 'cancelled'").total;
  res.json({ totalProducts, totalOrders, pendingOrders, totalRevenue });
});

app.get('/api/settings', async (req, res) => {
  await ensureDb();
  const rows = getAll('SELECT * FROM settings');
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  settings.store_phone = settings.store_phone || config.store_phone;
  settings.store_address = settings.store_address || config.store_address;
  settings.store_name = settings.store_name || config.store_name;
  settings.currency_symbol = settings.currency_symbol || config.currency_symbol;
  settings.telegram_bot_token = settings.telegram_bot_token || config.telegram_bot_token;
  settings.telegram_chat_id = settings.telegram_chat_id || config.telegram_chat_id;
  res.json(settings);
});

app.put('/api/admin/settings', authMiddleware, async (req, res) => {
  await ensureDb();
  const { store_phone, store_address, store_name, store_description, about_title, about_text,
    telegram_bot_token, telegram_chat_id,
    color_header_bg, color_header_text, color_hero_bg, color_body_bg, color_product_card_bg,
    color_text_primary, color_text_secondary, color_accent } = req.body;
  function saveSetting(key, value) {
    if (value === undefined) return;
    const existing = getOne(`SELECT key FROM settings WHERE key = '${key}'`);
    if (existing) { runQuery(`UPDATE settings SET value = ? WHERE key = '${key}'`, [value]); }
    else { runQuery(`INSERT INTO settings (key, value) VALUES ('${key}', ?)`, [value]); }
  }
  saveSetting('store_phone', store_phone);
  saveSetting('store_address', store_address);
  saveSetting('store_name', store_name);
  saveSetting('store_description', store_description);
  saveSetting('about_title', about_title);
  saveSetting('about_text', about_text);
  saveSetting('telegram_bot_token', telegram_bot_token);
  saveSetting('telegram_chat_id', telegram_chat_id);
  saveSetting('color_header_bg', color_header_bg);
  saveSetting('color_header_text', color_header_text);
  saveSetting('color_hero_bg', color_hero_bg);
  saveSetting('color_body_bg', color_body_bg);
  saveSetting('color_product_card_bg', color_product_card_bg);
  saveSetting('color_text_primary', color_text_primary);
  saveSetting('color_text_secondary', color_text_secondary);
  saveSetting('color_accent', color_accent);
  res.json({ success: true });
});

app.post('/api/admin/login', async (req, res) => {
  await ensureDb();
  const { password } = req.body;
  if (password === config.admin_password) {
    res.json({ success: true, token: config.admin_password });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/index.html')));
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/index.html')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public/index.html'));
  }
});

module.exports = app;
