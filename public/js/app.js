let allProducts = [];
let currentCategory = 'all';
let currentSearch = '';
let currentQuantity = 1;
let siteSettings = {};

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadProducts();
  initFilters();
  initSearch();
  initModal();
});

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    siteSettings = await res.json();

    document.getElementById('contactPhone').textContent = siteSettings.store_phone || '+9647801234567';
    document.getElementById('contactAddress').textContent = siteSettings.store_address || 'شارع المتنبي، بغداد، العراق';

    if (siteSettings.store_name) {
      document.querySelector('.logo').textContent = siteSettings.store_name;
      document.title = siteSettings.store_name + ' - متجر الموبايلات';
    }

    if (siteSettings.store_description) {
      document.querySelector('.hero p').textContent = siteSettings.store_description;
    }

    const aboutTitle = document.getElementById('aboutTitle');
    const aboutText = document.getElementById('aboutText');
    if (siteSettings.about_title) aboutTitle.textContent = siteSettings.about_title;
    if (siteSettings.about_text) aboutText.textContent = siteSettings.about_text;

    const root = document.documentElement;
    if (siteSettings.color_accent) root.style.setProperty('--pink', siteSettings.color_accent);
    if (siteSettings.color_header_bg) {
      root.style.setProperty('--header-bg', siteSettings.color_header_bg);
      document.querySelector('.header').style.background = siteSettings.color_header_bg;
    }
    if (siteSettings.color_header_text) {
      document.querySelector('.header').style.color = siteSettings.color_header_text;
      document.querySelectorAll('.nav a').forEach(a => a.style.color = siteSettings.color_header_text);
      document.querySelector('.menu-toggle').style.color = siteSettings.color_header_text;
    }
    if (siteSettings.color_hero_bg) {
      document.querySelector('.hero').style.background = `linear-gradient(135deg, ${siteSettings.color_accent || '#E88DB5'}, ${siteSettings.color_hero_bg})`;
    }
    if (siteSettings.color_body_bg) {
      document.body.style.background = siteSettings.color_body_bg;
      const isLight = isLightColor(siteSettings.color_body_bg);
      document.body.style.color = isLight ? '#222' : '#fff';
    }
    if (siteSettings.color_product_card_bg) {
      document.querySelectorAll('.product-card').forEach(c => c.style.background = siteSettings.color_product_card_bg);
    }
    if (siteSettings.color_text_primary) {
      document.querySelectorAll('.product-name').forEach(n => n.style.color = siteSettings.color_text_primary);
      document.querySelectorAll('.section-title').forEach(t => t.style.color = siteSettings.color_text_primary);
    }
  } catch {
    document.getElementById('contactPhone').textContent = '+9647801234567';
    document.getElementById('contactAddress').textContent = 'شارع المتنبي، بغداد، العراق';
  }
}

function isLightColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    allProducts = await res.json();
    renderProducts();
  } catch {
    document.getElementById('productsGrid').innerHTML = '<p class="no-products">تعذر تحميل المنتجات</p>';
  }
}

function renderProducts() {
  const grid = document.getElementById('productsGrid');
  const filtered = allProducts.filter(p => {
    const matchCategory = currentCategory === 'all' || p.category === currentCategory;
    const matchSearch = !currentSearch || p.name.includes(currentSearch);
    return matchCategory && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<p class="no-products">لا توجد منتجات</p>';
    return;
  }

  const currency = siteSettings.currency_symbol || 'د.ع';

  grid.innerHTML = filtered.map(p => `
    <div class="product-card" onclick="openOrderModal(${p.id}, '${p.name.replace(/'/g, "\\'")}')">
      <img class="product-image" src="${p.image || '/images/placeholder.svg'}" alt="${p.name}" onerror="this.src='/images/placeholder.svg'">
      <div class="product-info">
        <h3 class="product-name">${p.name}</h3>
        ${p.description ? `<p class="product-desc">${p.description}</p>` : ''}
        <div>
          <span class="product-price">${Number(p.price).toLocaleString('ar-IQ')} ${currency}</span>
          ${p.original_price ? `<span class="product-original-price">${Number(p.original_price).toLocaleString('ar-IQ')} ${currency}</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  if (siteSettings.color_product_card_bg) {
    grid.querySelectorAll('.product-card').forEach(c => c.style.background = siteSettings.color_product_card_bg);
  }
  if (siteSettings.color_text_primary) {
    grid.querySelectorAll('.product-name').forEach(n => n.style.color = siteSettings.color_text_primary);
  }
}

function initFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.category;
      renderProducts();
    });
  });
}

function initSearch() {
  document.getElementById('searchInput').addEventListener('input', e => {
    currentSearch = e.target.value;
    renderProducts();
  });
}

function initModal() {
  const modal = document.getElementById('orderModal');
  document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('active'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });

  document.getElementById('qtyMinus').addEventListener('click', () => {
    if (currentQuantity > 1) {
      currentQuantity--;
      document.getElementById('qtyValue').textContent = currentQuantity;
    }
  });

  document.getElementById('qtyPlus').addEventListener('click', () => {
    currentQuantity++;
    document.getElementById('qtyValue').textContent = currentQuantity;
  });

  document.getElementById('orderForm').addEventListener('submit', submitOrder);
}

function openOrderModal(id, name) {
  currentQuantity = 1;
  document.getElementById('qtyValue').textContent = 1;
  document.getElementById('orderProductId').value = id;
  document.getElementById('modalProductName').textContent = name;
  document.getElementById('orderForm').reset();
  document.getElementById('qtyValue').textContent = 1;
  document.getElementById('orderModal').classList.add('active');
}

let isSubmitting = false;

async function submitOrder(e) {
  e.preventDefault();
  if (isSubmitting) return;
  isSubmitting = true;
  const submitBtn = document.querySelector('#orderForm button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'جاري الإرسال...';
  submitBtn.disabled = true;

  const data = {
    product_id: Number(document.getElementById('orderProductId').value),
    quantity: currentQuantity,
    customer_name: document.getElementById('orderName').value,
    phone: document.getElementById('orderPhone').value,
    governorate: document.getElementById('orderGovernorate').value,
    address_detail: document.getElementById('orderAddress').value,
    notes: document.getElementById('orderNotes').value
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      showToast('تم إرسال طلبك بنجاح! سنتواصل معك قريباً');
      document.getElementById('orderModal').classList.remove('active');
      document.getElementById('orderForm').reset();
    } else {
      const err = await res.json();
      showToast(err.error || 'حدث خطأ، حاول مرة أخرى');
    }
  } catch {
    showToast('تعذر الاتصال بالخادم');
  } finally {
    isSubmitting = false;
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function closeMobileNav() {
  document.getElementById('mainNav').classList.remove('open');
}
