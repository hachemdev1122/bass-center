const express = require('express');
const { createClient } = require('@libsql/client');
const multer = require('multer');
const path = require('path');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

let config;
try { config = require('./config.json'); } catch { config = {}; }

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let db = null;

async function getDb() {
  if (db) return db;
  db = createClient({
    url: process.env.TURSO_DATABASE_URL || config.turso_database_url || 'file:local.db',
    authToken: process.env.TURSO_AUTH_TOKEN || config.turso_auth_token || undefined,
  });
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      original_price REAL,
      image TEXT,
      category TEXT DEFAULT 'mobiles',
      stock INTEGER DEFAULT 0,
      featured INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      governorate TEXT NOT NULL,
      address_detail TEXT,
      product_id INTEGER,
      product_name TEXT,
      quantity INTEGER DEFAULT 1,
      total_price REAL,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0
    );
  `);
  const catCount = await db.execute('SELECT COUNT(*) as count FROM categories');
  if (catCount.rows[0].count === 0) {
    await db.executeMultiple(`
      INSERT INTO categories (name, slug, sort_order) VALUES ('موبايلات', 'mobiles', 1);
      INSERT INTO categories (name, slug, sort_order) VALUES ('تابلت', 'tablets', 2);
      INSERT INTO categories (name, slug, sort_order) VALUES ('إكسسوارات', 'accessories', 3);
      INSERT INTO categories (name, slug, sort_order) VALUES ('أخرى', 'other', 4);
    `);
  }
  return db;
}

async function getSetting(key, defaultVal) {
  const d = await getDb();
  const rows = await d.execute({ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] });
  return rows.rows.length > 0 ? rows.rows[0].value : defaultVal;
}

async function setSetting(key, value) {
  const d = await getDb();
  await d.execute({ sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', args: [key, value] });
}

function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'];
  const adminPw = process.env.ADMIN_PASSWORD || config.admin_password;
  if (token === adminPw) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

let cachedTgSettings = null;
let tgCacheTime = 0;

async function sendTelegramNotification(message) {
  try {
    const now = Date.now();
    if (!cachedTgSettings || now - tgCacheTime > 60000) {
      const token = await getSetting('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || config.telegram_bot_token);
      const chatIdStr = await getSetting('telegram_chat_id', process.env.TELEGRAM_CHAT_ID || config.telegram_chat_id);
      cachedTgSettings = { token, chatIdStr };
      tgCacheTime = now;
    }
    const { token, chatIdStr } = cachedTgSettings;
    if (!token || token === 'YOUR_BOT_TOKEN_HERE' || !chatIdStr) return;
    const chatIds = chatIdStr.split(',').map(id => id.trim()).filter(id => id);
    await Promise.all(chatIds.map(chatId =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(5000)
      }).catch(() => {})
    ));
  } catch (err) { console.error('Telegram error:', err.message); }
}

app.get('/api/products', async (req, res) => {
  try {
    const d = await getDb();
    const { category, search, featured } = req.query;
    let sql = 'SELECT * FROM products';
    const conditions = [];
    const args = [];
    if (category) { conditions.push('category = ?'); args.push(category); }
    if (search) { conditions.push('name LIKE ?'); args.push(`%${search}%`); }
    if (featured === '1') { conditions.push('featured = 1'); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY id DESC';
    const rows = await d.execute({ sql, args });
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const d = await getDb();
    const rows = await d.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [parseInt(req.params.id)] });
    if (rows.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json(rows.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customer_name, phone, governorate, address_detail, product_id, quantity, notes } = req.body;
    if (!customer_name || !phone || !governorate || !product_id) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }
    const d = await getDb();
    const prodRows = await d.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [parseInt(product_id)] });
    if (prodRows.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    const product = prodRows.rows[0];
    const qty = parseInt(quantity) || 1;
    const total = product.price * qty;
    await d.execute({
      sql: 'INSERT INTO orders (customer_name, phone, governorate, address_detail, product_id, product_name, quantity, total_price, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [customer_name, phone, governorate, address_detail || '', parseInt(product_id), product.name, qty, total, notes || '']
    });
    await d.execute({ sql: 'UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?', args: [qty, parseInt(product_id)] });
    const storeName = await getSetting('store_name', process.env.STORE_NAME || 'Bass Center');
    const telegramMsg = [`🛒 <b>طلب جديد - ${storeName}</b>`, `━━━━━━━━━━━━━━━━━━━━`, ``, `👤 <b>العميل:</b> ${customer_name}`, `📱 <b>الهاتف:</b> ${phone}`, `📍 <b>المحافظة:</b> ${governorate}`, `🏠 <b>العنوان:</b> ${address_detail || 'غير محدد'}`, ``, `━━━━━━━━━━━━━━━━━━━━`, `📦 <b>المنتج:</b> ${product.name}`, `🔢 <b>الكمية:</b> ${qty}`, `💰 <b>السعر:</b> ${total.toLocaleString('ar-IQ')} د.ع`, ``, `📝 <b>ملاحظات:</b> ${notes || 'لا يوجد'}`, ``, `⏰ ${new Date().toLocaleString('ar-IQ')}`].join('\n');
    await sendTelegramNotification(telegramMsg);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/products', authMiddleware, async (req, res) => {
  try {
    const d = await getDb();
    const rows = await d.execute('SELECT * FROM products ORDER BY id DESC');
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/products', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, original_price, category, stock, featured } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Name and price are required' });
    let image = '';
    if (req.file) {
      image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    } else if (req.body.image) {
      image = req.body.image;
    }
    const d = await getDb();
    const result = await d.execute({
      sql: 'INSERT INTO products (name, description, price, original_price, image, category, stock, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [name, description || '', parseFloat(price), original_price ? parseFloat(original_price) : null, image, category || 'mobiles', parseInt(stock) || 0, featured === 'true' || featured === '1' ? 1 : 0]
    });
    res.json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/products/:id', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const d = await getDb();
    const prodRows = await d.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [parseInt(req.params.id)] });
    if (prodRows.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    const existing = prodRows.rows[0];
    const { name, description, price, original_price, category, stock, featured } = req.body;
    let image = existing.image;
    if (req.file) {
      image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    } else if (req.body.image !== undefined) {
      image = req.body.image;
    }
    await d.execute({
      sql: 'UPDATE products SET name=?, description=?, price=?, original_price=?, image=?, category=?, stock=?, featured=? WHERE id=?',
      args: [
        name || existing.name,
        description !== undefined ? description : existing.description,
        price ? parseFloat(price) : existing.price,
        original_price !== undefined ? (original_price ? parseFloat(original_price) : null) : existing.original_price,
        image, category || existing.category,
        stock !== undefined ? parseInt(stock) : existing.stock,
        featured !== undefined ? (featured === 'true' || featured === '1' ? 1 : 0) : existing.featured,
        parseInt(req.params.id)
      ]
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/products/:id', authMiddleware, async (req, res) => {
  try {
    const d = await getDb();
    await d.execute({ sql: 'DELETE FROM products WHERE id = ?', args: [parseInt(req.params.id)] });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/orders', authMiddleware, async (req, res) => {
  try {
    const d = await getDb();
    const { status } = req.query;
    let sql = 'SELECT * FROM orders';
    const args = [];
    if (status) { sql += ' WHERE status = ?'; args.push(status); }
    sql += ' ORDER BY id DESC';
    const rows = await d.execute({ sql, args });
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/orders/:id', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const d = await getDb();
    const ordRows = await d.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [parseInt(req.params.id)] });
    if (ordRows.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    const order = ordRows.rows[0];
    await d.execute({ sql: 'UPDATE orders SET status = ? WHERE id = ?', args: [status, parseInt(req.params.id)] });
    const statusLabels = { pending: 'قيد الانتظار', confirmed: 'تم التأكيد', shipped: 'تم الشحن', delivered: 'تم التوصيل', cancelled: 'ملغي' };
    sendTelegramNotification(`📊 تحديث الطلب #${order.id}\nالعميل: ${order.customer_name}\nالحالة: ${statusLabels[status]}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/orders/:id', authMiddleware, async (req, res) => {
  try {
    const d = await getDb();
    await d.execute({ sql: 'DELETE FROM orders WHERE id = ?', args: [parseInt(req.params.id)] });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/categories', async (req, res) => {
  try {
    const d = await getDb();
    const rows = await d.execute('SELECT * FROM categories ORDER BY sort_order ASC');
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/categories', authMiddleware, async (req, res) => {
  try {
    const { name, slug } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug required' });
    const d = await getDb();
    const maxSort = await d.execute('SELECT COALESCE(MAX(sort_order), 0) as m FROM categories');
    await d.execute({
      sql: 'INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)',
      args: [name, slug, maxSort.rows[0].m + 1]
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/categories/:id', authMiddleware, async (req, res) => {
  try {
    const { name, slug } = req.body;
    const d = await getDb();
    await d.execute({ sql: 'UPDATE categories SET name=?, slug=? WHERE id=?', args: [name, slug, parseInt(req.params.id)] });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/categories/:id', authMiddleware, async (req, res) => {
  try {
    const d = await getDb();
    await d.execute({ sql: 'DELETE FROM categories WHERE id = ?', args: [parseInt(req.params.id)] });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  try {
    const d = await getDb();
    const products = await d.execute('SELECT COUNT(*) as count FROM products');
    const orders = await d.execute('SELECT COUNT(*) as count FROM orders');
    const pending = await d.execute("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'");
    const revenue = await d.execute("SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status != 'cancelled'");
    res.json({
      totalProducts: products.rows[0].count,
      totalOrders: orders.rows[0].count,
      pendingOrders: pending.rows[0].count,
      totalRevenue: revenue.rows[0].total
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/settings', async (req, res) => {
  try {
    res.json({
      store_phone: await getSetting('store_phone', process.env.STORE_PHONE || '+9647801234567'),
      store_address: await getSetting('store_address', process.env.STORE_ADDRESS || 'شارع المتنبي، بغداد، العراق'),
      store_name: await getSetting('store_name', process.env.STORE_NAME || 'مركز كيو - Bass Center'),
      store_description: await getSetting('store_description', ''),
      about_title: await getSetting('about_title', ''),
      about_text: await getSetting('about_text', ''),
      currency_symbol: 'د.ع',
      color_header_bg: await getSetting('color_header_bg', '#ffffff'),
      color_header_text: await getSetting('color_header_text', '#333333'),
      color_hero_bg: await getSetting('color_hero_bg', '#1a1a1a'),
      color_body_bg: await getSetting('color_body_bg', '#f5f5f5'),
      color_product_card_bg: await getSetting('color_product_card_bg', '#ffffff'),
      color_text_primary: await getSetting('color_text_primary', '#333333'),
      color_text_secondary: await getSetting('color_text_secondary', '#666666'),
      color_accent: await getSetting('color_accent', '#E88DB5'),
      telegram_bot_token: await getSetting('telegram_bot_token', ''),
      telegram_chat_id: await getSetting('telegram_chat_id', '')
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/settings', authMiddleware, async (req, res) => {
  try {
    const fields = ['store_phone', 'store_address', 'store_name', 'store_description', 'about_title', 'about_text',
      'telegram_bot_token', 'telegram_chat_id',
      'color_header_bg', 'color_header_text', 'color_hero_bg', 'color_body_bg', 'color_product_card_bg',
      'color_text_primary', 'color_text_secondary', 'color_accent'];
    for (const f of fields) {
      if (req.body[f] !== undefined) await setSetting(f, req.body[f]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    const adminPw = process.env.ADMIN_PASSWORD || config.admin_password;
    if (password === adminPw) {
      res.json({ success: true, token: adminPw });
    } else {
      res.status(401).json({ error: 'Invalid password' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/index.html')));
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/index.html')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public/index.html'));
  }
});

const PORT = process.env.PORT || config.port || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
