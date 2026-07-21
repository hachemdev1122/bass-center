let adminToken = localStorage.getItem('adminToken') || '';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('settingsForm').addEventListener('submit', saveSettings);

  document.querySelectorAll('.sidebar-link[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-link').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page' + capitalize(btn.dataset.page)).classList.add('active');

      if (btn.dataset.page === 'dashboard') loadDashboard();
      if (btn.dataset.page === 'products') loadAdminProducts();
      if (btn.dataset.page === 'orders') loadOrders();
      if (btn.dataset.page === 'categories') loadCategories();
      if (btn.dataset.page === 'settings') loadSettings();

      document.getElementById('sidebar').classList.remove('open');
    });
  });

  document.getElementById('productForm').addEventListener('submit', saveProduct);

  if (adminToken) {
    showAdminPanel();
  }
});

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function handleLogin(e) {
  e.preventDefault();
  const password = document.getElementById('loginPassword').value;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      adminToken = data.token;
      localStorage.setItem('adminToken', adminToken);
      showAdminPanel();
    } else {
      document.getElementById('loginError').textContent = 'كلمة المرور غير صحيحة';
    }
  } catch {
    document.getElementById('loginError').textContent = 'تعذر الاتصال بالخادم';
  }
}

function showAdminPanel() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminPanel').style.display = 'flex';
  loadDashboard();
}

function handleLogout() {
  adminToken = '';
  localStorage.removeItem('adminToken');
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminPanel').style.display = 'none';
}

function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Token': adminToken
  };
}

async function loadDashboard() {
  try {
    const res = await fetch('/api/admin/stats', { headers: { 'X-Admin-Token': adminToken } });
    const stats = await res.json();
    document.getElementById('dashboardStats').innerHTML = `
      <div class="dash-card"><h3>${stats.totalProducts || 0}</h3><p>إجمالي المنتجات</p></div>
      <div class="dash-card"><h3>${stats.totalOrders || 0}</h3><p>إجمالي الطلبات</p></div>
      <div class="dash-card"><h3>${stats.pendingOrders || 0}</h3><p>طلبات معلقة</p></div>
      <div class="dash-card"><h3>${Number(stats.revenue || 0).toLocaleString('ar-IQ')} د.ع</h3><p>الإيرادات</p></div>
    `;
  } catch {
    document.getElementById('dashboardStats').innerHTML = '<p>تعذر تحميل الإحصائيات</p>';
  }
}

async function loadAdminProducts() {
  try {
    const [prodRes, catRes] = await Promise.all([
      fetch('/api/admin/products', { headers: { 'X-Admin-Token': adminToken } }),
      fetch('/api/categories')
    ]);
    const products = await prodRes.json();
    allCategories = await catRes.json();
    updateCategorySelect();
    document.getElementById('productsTableBody').innerHTML = products.map(p => `
      <tr>
        <td>${p.name}</td>
        <td>${p.description || '-'}</td>
        <td>${Number(p.price).toLocaleString('ar-IQ')} د.ع</td>
        <td>${allCategories.find(c => c.slug === p.category)?.name || p.category}</td>
        <td>${p.stock}</td>
        <td>
          <div class="table-actions">
            <button class="btn-edit" onclick="editProduct(${p.id})">تعديل</button>
            <button class="btn-delete" onclick="deleteProduct(${p.id})">حذف</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch {
    document.getElementById('productsTableBody').innerHTML = '<tr><td colspan="6">تعذر تحميل المنتجات</td></tr>';
  }
}

async function loadOrders() {
  try {
    const res = await fetch('/api/admin/orders', { headers: { 'X-Admin-Token': adminToken } });
    const orders = await res.json();
    document.getElementById('ordersTableBody').innerHTML = orders.map(o => `
      <tr>
        <td>${o.id}</td>
        <td>${o.customer_name}</td>
        <td>${o.phone}</td>
        <td>${o.governorate}<br><small style="color:var(--light-gray)">${o.address_detail || ''}</small></td>
        <td><span class="status-badge status-${o.status}">${translateStatus(o.status)}</span></td>
        <td>
          <select class="status-select" onchange="updateOrderStatus(${o.id}, this.value)">
            <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>معلق</option>
            <option value="confirmed" ${o.status === 'confirmed' ? 'selected' : ''}>مؤكد</option>
            <option value="shipped" ${o.status === 'shipped' ? 'selected' : ''}>تم الشحن</option>
            <option value="delivered" ${o.status === 'delivered' ? 'selected' : ''}>تم التوصيل</option>
            <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>ملغي</option>
          </select>
        </td>
      </tr>
    `).join('');
  } catch {
    document.getElementById('ordersTableBody').innerHTML = '<tr><td colspan="6">تعذر تحميل الطلبات</td></tr>';
  }
}

function translateStatus(status) {
  const map = { pending: 'معلق', confirmed: 'مؤكد', shipped: 'تم الشحن', delivered: 'تم التوصيل', cancelled: 'ملغي' };
  return map[status] || status;
}

function syncColorInputs(colorId, textId) {
  const colorInput = document.getElementById(colorId);
  const textInput = document.getElementById(textId);
  if (!colorInput || !textInput) return;
  colorInput.addEventListener('input', () => { textInput.value = colorInput.value; });
  textInput.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(textInput.value)) colorInput.value = textInput.value; });
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    document.getElementById('sStoreName').value = s.store_name || '';
    document.getElementById('sStoreDescription').value = s.store_description || '';
    document.getElementById('sStorePhone').value = s.store_phone || '';
    document.getElementById('sStoreAddress').value = s.store_address || '';
    document.getElementById('sAboutTitle').value = s.about_title || 'من نحن';
    document.getElementById('sAboutText').value = s.about_text || '';
    document.getElementById('sTelegramToken').value = s.telegram_bot_token || '';
    document.getElementById('sTelegramChatId').value = s.telegram_chat_id || '';

    const colors = {
      sColorHeaderBg: s.color_header_bg || '#ffffff',
      sColorHeaderText: s.color_header_text || '#333333',
      sColorHeroBg: s.color_hero_bg || '#1a1a1a',
      sColorBodyBg: s.color_body_bg || '#f5f5f5',
      sColorProductCardBg: s.color_product_card_bg || '#ffffff',
      sColorTextPrimary: s.color_text_primary || '#222222',
      sColorTextSecondary: s.color_text_secondary || '#888888',
      sColorAccent: s.color_accent || '#E88DB5'
    };
    for (const [id, val] of Object.entries(colors)) {
      document.getElementById(id).value = val;
      document.getElementById(id + 'Text').value = val;
    }
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  syncColorInputs('sColorHeaderBg', 'sColorHeaderBgText');
  syncColorInputs('sColorHeaderText', 'sColorHeaderTextText');
  syncColorInputs('sColorHeroBg', 'sColorHeroBgText');
  syncColorInputs('sColorBodyBg', 'sColorBodyBgText');
  syncColorInputs('sColorProductCardBg', 'sColorProductCardBgText');
  syncColorInputs('sColorTextPrimary', 'sColorTextPrimaryText');
  syncColorInputs('sColorTextSecondary', 'sColorTextSecondaryText');
  syncColorInputs('sColorAccent', 'sColorAccentText');
});

async function saveSettings(e) {
  e.preventDefault();
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({
        store_name: document.getElementById('sStoreName').value,
        store_description: document.getElementById('sStoreDescription').value,
        store_phone: document.getElementById('sStorePhone').value,
        store_address: document.getElementById('sStoreAddress').value,
        about_title: document.getElementById('sAboutTitle').value,
        about_text: document.getElementById('sAboutText').value,
        telegram_bot_token: document.getElementById('sTelegramToken').value,
        telegram_chat_id: document.getElementById('sTelegramChatId').value,
        color_header_bg: document.getElementById('sColorHeaderBg').value,
        color_header_text: document.getElementById('sColorHeaderText').value,
        color_hero_bg: document.getElementById('sColorHeroBg').value,
        color_body_bg: document.getElementById('sColorBodyBg').value,
        color_product_card_bg: document.getElementById('sColorProductCardBg').value,
        color_text_primary: document.getElementById('sColorTextPrimary').value,
        color_text_secondary: document.getElementById('sColorTextSecondary').value,
        color_accent: document.getElementById('sColorAccent').value
      })
    });
    if (res.ok) {
      showToast('تم حفظ الإعدادات بنجاح');
    } else {
      showToast('حدث خطأ أثناء الحفظ');
    }
  } catch {
    showToast('تعذر الاتصال بالخادم');
  }
}

function updateCategorySelect() {
  const sel = document.getElementById('pCategory');
  if (!sel) return;
  sel.innerHTML = allCategories.map(c => `<option value="${c.slug}">${c.name}</option>`).join('');
}

function showProductForm(product = null) {
  document.getElementById('productFormContainer').style.display = 'block';
  document.getElementById('editProductId').value = product ? product.id : '';
  document.getElementById('pName').value = product ? product.name : '';
  document.getElementById('pDesc').value = product ? product.description : '';
  document.getElementById('pPrice').value = product ? product.price : '';
  document.getElementById('pOriginalPrice').value = product ? product.original_price : '';
  document.getElementById('pCategory').value = product ? product.category : 'mobiles';
  document.getElementById('pStock').value = product ? product.stock : '';
  document.getElementById('pFeatured').checked = product ? product.featured : false;
}

function hideProductForm() {
  document.getElementById('productFormContainer').style.display = 'none';
  document.getElementById('productForm').reset();
  document.getElementById('editProductId').value = '';
}

async function editProduct(id) {
  try {
    const res = await fetch('/api/admin/products', { headers: { 'X-Admin-Token': adminToken } });
    const products = await res.json();
    const product = products.find(p => p.id === id);
    if (product) showProductForm(product);
  } catch {}
}

async function saveProduct(e) {
  e.preventDefault();
  const id = document.getElementById('editProductId').value;
  const formData = new FormData();
  formData.append('name', document.getElementById('pName').value);
  formData.append('description', document.getElementById('pDesc').value);
  formData.append('price', Number(document.getElementById('pPrice').value));
  formData.append('original_price', Number(document.getElementById('pOriginalPrice').value) || '');
  formData.append('category', document.getElementById('pCategory').value);
  formData.append('stock', Number(document.getElementById('pStock').value));
  formData.append('featured', document.getElementById('pFeatured').checked ? 'true' : 'false');

  const imageFile = document.getElementById('pImage').files[0];
  if (imageFile) {
    formData.append('image', imageFile);
  }

  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/admin/products/${id}` : '/api/admin/products';
    const res = await fetch(url, {
      method,
      headers: { 'X-Admin-Token': adminToken },
      body: formData
    });

    if (res.ok) {
      showToast('تم حفظ المنتج بنجاح');
      hideProductForm();
      loadAdminProducts();
    } else {
      showToast('حدث خطأ أثناء الحفظ');
    }
  } catch {
    showToast('تعذر الاتصال بالخادم');
  }
}

async function deleteProduct(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المنتج؟')) return;
  try {
    const res = await fetch(`/api/admin/products/${id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': adminToken }
    });
    if (res.ok) {
      showToast('تم حذف المنتج');
      loadAdminProducts();
    } else {
      showToast('حدث خطأ أثناء الحذف');
    }
  } catch {
    showToast('تعذر الاتصال بالخادم');
  }
}

async function updateOrderStatus(id, status) {
  try {
    const res = await fetch(`/api/admin/orders/${id}`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      showToast('تم تحديث حالة الطلب');
      loadOrders();
    } else {
      showToast('حدث خطأ أثناء التحديث');
    }
  } catch {
    showToast('تعذر الاتصال بالخادم');
  }
}

async function deleteOrder(id) {
  if (!confirm('هل أنت متأكد من حذف هذا الطلب؟')) return;
  try {
    const res = await fetch(`/api/admin/orders/${id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': adminToken }
    });
    if (res.ok) {
      showToast('تم حذف الطلب');
      loadOrders();
    } else {
      showToast('حدث خطأ أثناء الحذف');
    }
  } catch {
    showToast('تعذر الاتصال بالخادم');
  }
}

let allCategories = [];

async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    allCategories = await res.json();
    document.getElementById('categoriesTableBody').innerHTML = allCategories.map(c => `
      <tr>
        <td><input type="text" value="${c.name}" id="catName_${c.id}" style="border:1px solid #ddd;padding:4px 8px;border-radius:4px;width:100%;"></td>
        <td><input type="text" value="${c.slug}" id="catSlug_${c.id}" style="border:1px solid #ddd;padding:4px 8px;border-radius:4px;width:100%;"></td>
        <td>
          <div class="table-actions">
            <button class="btn-edit" onclick="updateCategory(${c.id})">حفظ</button>
            <button class="btn-delete" onclick="deleteCategory(${c.id})">حذف</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch {
    document.getElementById('categoriesTableBody').innerHTML = '<tr><td colspan="3">تعذر تحميل الفئات</td></tr>';
  }
}

async function addCategory() {
  const name = document.getElementById('catName').value.trim();
  const slug = document.getElementById('catSlug').value.trim();
  if (!name || !slug) { showToast('أدخل اسم الفئة والرمز'); return; }
  try {
    const res = await fetch('/api/admin/categories', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ name, slug })
    });
    if (res.ok) {
      showToast('تم إضافة الفئة');
      document.getElementById('catName').value = '';
      document.getElementById('catSlug').value = '';
      loadCategories();
    } else {
      showToast('حدث خطأ');
    }
  } catch { showToast('تعذر الاتصال بالخادم'); }
}

async function updateCategory(id) {
  const name = document.getElementById(`catName_${id}`).value.trim();
  const slug = document.getElementById(`catSlug_${id}`).value.trim();
  if (!name || !slug) { showToast('أدخل اسم الفئة والرمز'); return; }
  try {
    const res = await fetch(`/api/admin/categories/${id}`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ name, slug })
    });
    if (res.ok) { showToast('تم تحديث الفئة'); loadCategories(); }
    else { showToast('حدث خطأ'); }
  } catch { showToast('تعذر الاتصال بالخادم'); }
}

async function deleteCategory(id) {
  if (!confirm('هل أنت متأكد من حذف هذه الفئة؟')) return;
  try {
    const res = await fetch(`/api/admin/categories/${id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': adminToken }
    });
    if (res.ok) { showToast('تم حذف الفئة'); loadCategories(); }
    else { showToast('حدث خطأ'); }
  } catch { showToast('تعذر الاتصال بالخادم'); }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function toggleMobileSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function resetColors() {
  const defaults = {
    sColorHeaderBg: '#ffffff',
    sColorHeaderText: '#333333',
    sColorHeroBg: '#1a1a1a',
    sColorBodyBg: '#f5f5f5',
    sColorProductCardBg: '#ffffff',
    sColorTextPrimary: '#222222',
    sColorTextSecondary: '#888888',
    sColorAccent: '#E88DB5'
  };
  for (const [id, val] of Object.entries(defaults)) {
    document.getElementById(id).value = val;
    document.getElementById(id + 'Text').value = val;
  }
  showToast('تمت إعادة تعيين الألوان - اضغط حفظ للتأكيد');
}
