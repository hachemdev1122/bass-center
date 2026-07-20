const express = require('express');
const multer = require('multer');
const path = require('path');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const config = require('./config.json');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let products = [];
let orders = [];
let settings = {};
let nextProductId = 1;
let nextOrderId = 1;

function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token === config.admin_password) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

async function sendTelegramNotification(message) {
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

app.get('/api/products', (req, res) => {
  const { category, search, featured } = req.query;
  let filtered = [...products];
  if (category) filtered = filtered.filter(p => p.category === category);
  if (search) filtered = filtered.filter(p => p.name.includes(search) || (p.description && p.description.includes(search)));
  if (featured === '1') filtered = filtered.filter(p => p.featured);
  filtered.sort((a, b) => b.id - a.id);
  res.json(filtered);
});

app.get('/api/products/:id', (req, res) => {
  const product = products.find(p => p.id === parseInt(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

app.post('/api/orders', (req, res) => {
  const { customer_name, phone, governorate, address_detail, product_id, quantity, notes } = req.body;
  if (!customer_name || !phone || !governorate || !product_id) {
    return res.status(400).json({ error: 'All required fields must be filled' });
  }
  const product = products.find(p => p.id === parseInt(product_id));
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const qty = quantity || 1;
  const total = product.price * qty;
  const order = {
    id: nextOrderId++,
    customer_name, phone, governorate, address_detail: address_detail || '',
    product_id: parseInt(product_id), product_name: product.name,
    quantity: parseInt(qty), total_price: total,
    status: 'pending', notes: notes || '',
    created_at: new Date().toISOString()
  };
  orders.push(order);
  product.stock = Math.max(0, product.stock - parseInt(qty));

  const storeName = settings.store_name || config.store_name;
  const telegramMsg = [`🛒 <b>طلب جديد - ${storeName}</b>`, `━━━━━━━━━━━━━━━━━━━━`, ``, `👤 <b>العميل:</b> ${customer_name}`, `📱 <b>الهاتف:</b> ${phone}`, `📍 <b>المحافظة:</b> ${governorate}`, `🏠 <b>العنوان:</b> ${address_detail || 'غير محدد'}`, ``, `━━━━━━━━━━━━━━━━━━━━`, `📦 <b>المنتج:</b> ${product.name}`, `🔢 <b>الكمية:</b> ${qty}`, `💰 <b>السعر:</b> ${total.toLocaleString('ar-IQ')} د.ع`, ``, `📝 <b>ملاحظات:</b> ${notes || 'لا يوجد'}`, ``, `━━━━━━━━━━━━━━━━━━━━`, `📋 <b>رقم الطلب:</b> #${order.id}`, `⏰ ${new Date().toLocaleString('ar-IQ')}`].join('\n');
  sendTelegramNotification(telegramMsg);
  res.json({ success: true, order });
});

app.get('/api/admin/products', authMiddleware, (req, res) => {
  res.json([...products].sort((a, b) => b.id - a.id));
});

app.post('/api/admin/products', authMiddleware, upload.single('image'), (req, res) => {
  const { name, description, price, original_price, category, stock, featured } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price are required' });
  let image = '';
  if (req.file) {
    image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  } else if (req.body.image) {
    image = req.body.image;
  }
  const product = {
    id: nextProductId++,
    name, description: description || '',
    price: parseFloat(price),
    original_price: original_price ? parseFloat(original_price) : null,
    image, category: category || 'mobiles',
    stock: parseInt(stock) || 0,
    featured: featured === 'true' || featured === '1' ? 1 : 0,
    created_at: new Date().toISOString()
  };
  products.push(product);
  res.json({ success: true, id: product.id });
});

app.put('/api/admin/products/:id', authMiddleware, upload.single('image'), (req, res) => {
  const idx = products.findIndex(p => p.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Product not found' });
  const existing = products[idx];
  const { name, description, price, original_price, category, stock, featured } = req.body;
  let image = existing.image;
  if (req.file) {
    image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  } else if (req.body.image !== undefined) {
    image = req.body.image;
  }
  products[idx] = {
    ...existing,
    name: name || existing.name,
    description: description !== undefined ? description : existing.description,
    price: price ? parseFloat(price) : existing.price,
    original_price: original_price !== undefined ? (original_price ? parseFloat(original_price) : null) : existing.original_price,
    image, category: category || existing.category,
    stock: stock !== undefined ? parseInt(stock) : existing.stock,
    featured: featured !== undefined ? (featured === 'true' || featured === '1' ? 1 : 0) : existing.featured
  };
  res.json({ success: true });
});

app.delete('/api/admin/products/:id', authMiddleware, (req, res) => {
  const idx = products.findIndex(p => p.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Product not found' });
  products.splice(idx, 1);
  res.json({ success: true });
});

app.get('/api/admin/orders', authMiddleware, (req, res) => {
  const { status } = req.query;
  let filtered = [...orders];
  if (status) filtered = filtered.filter(o => o.status === status);
  filtered.sort((a, b) => b.id - a.id);
  res.json(filtered);
});

app.put('/api/admin/orders/:id', authMiddleware, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const order = orders.find(o => o.id === parseInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.status = status;
  const statusLabels = { pending: 'قيد الانتظار', confirmed: 'تم التأكيد', shipped: 'تم الشحن', delivered: 'تم التوصيل', cancelled: 'ملغي' };
  sendTelegramNotification(`📊 تحديث الطلب #${order.id}\nالعميل: ${order.customer_name}\nالحالة: ${statusLabels[status]}`);
  res.json({ success: true });
});

app.get('/api/admin/stats', authMiddleware, (req, res) => {
  const totalProducts = products.length;
  const totalOrders = orders.length;
  const pendingOrders = orders.filter(o => o.status === 'pending').length;
  const totalRevenue = orders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.total_price, 0);
  res.json({ totalProducts, totalOrders, pendingOrders, totalRevenue });
});

app.get('/api/settings', (req, res) => {
  res.json({
    ...settings,
    store_phone: settings.store_phone || config.store_phone,
    store_address: settings.store_address || config.store_address,
    store_name: settings.store_name || config.store_name,
    currency_symbol: settings.currency_symbol || config.currency_symbol,
    telegram_bot_token: settings.telegram_bot_token || config.telegram_bot_token,
    telegram_chat_id: settings.telegram_chat_id || config.telegram_chat_id
  });
});

app.put('/api/admin/settings', authMiddleware, (req, res) => {
  const fields = ['store_phone', 'store_address', 'store_name', 'store_description', 'about_title', 'about_text',
    'telegram_bot_token', 'telegram_chat_id',
    'color_header_bg', 'color_header_text', 'color_hero_bg', 'color_body_bg', 'color_product_card_bg',
    'color_text_primary', 'color_text_secondary', 'color_accent'];
  fields.forEach(f => { if (req.body[f] !== undefined) settings[f] = req.body[f]; });
  res.json({ success: true });
});

app.post('/api/admin/login', (req, res) => {
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

const PORT = process.env.PORT || config.port || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
