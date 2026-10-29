(() => {
  'use strict';

  const CATEGORY_LABELS = Object.freeze({
    diamonds: 'الجواهر',
    codes: 'الأكواد',
    skins: 'السكنات',
    emotes: 'الرقصات'
  });
  const STORAGE_KEY = 'bluedrop.cart.v2';
  const $ = (id) => document.getElementById(id);
  const categoryButtons = [...document.querySelectorAll('[data-filter]')];
  const productGrid = $('productGrid');
  const cartDrawer = $('cartDrawer');
  const productDialog = $('productDialogBackdrop');
  const checkoutDialog = $('checkoutBackdrop');
  const overlay = $('overlay');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    products: Array.isArray(window.BlueDropCatalog) ? [...window.BlueDropCatalog] : [],
    category: 'all',
    query: '',
    sort: 'featured',
    cart: readCart(),
    activeProduct: null,
    previousFocus: null,
    idempotencyKey: null,
    toastTimer: null
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function formatPrice(value) {
    return new Intl.NumberFormat('ar-DZ', { maximumFractionDigits: 0 }).format(value) + ' د.ج';
  }

  function readCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      return Object.fromEntries(Object.entries(raw).filter(([key, qty]) =>
        /^\d+$/.test(key) && Number.isSafeInteger(qty) && qty > 0 && qty <= 20
      ));
    } catch {
      return {};
    }
  }

  function persistCart() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cart));
    } catch {
      // Private browsing or storage policies may disable persistence. The cart still works in memory.
    }
  }

  function toast(message, kind = 'success') {
    const node = $('toast');
    node.textContent = message;
    node.dataset.kind = kind;
    node.classList.add('show');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => node.classList.remove('show'), 3100);
  }

  function currentProducts() {
    const query = state.query.toLocaleLowerCase('ar');
    const result = state.products.filter((product) => {
      if (product.active === false) return false;
      const matchesCategory = state.category === 'all' || product.category === state.category;
      const searchable = `${product.name} ${product.description} ${CATEGORY_LABELS[product.category] || ''} ${product.slug || ''}`;
      return matchesCategory && searchable.toLocaleLowerCase('ar').includes(query);
    });

    if (state.sort === 'low') result.sort((a, b) => a.price - b.price);
    else if (state.sort === 'high') result.sort((a, b) => b.price - a.price);
    else if (state.sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    else result.sort((a, b) => (a.featured ?? a.id) - (b.featured ?? b.id));
    return result;
  }

  function renderProducts() {
    const products = currentProducts();
    productGrid.setAttribute('aria-busy', 'false');
    productGrid.innerHTML = products.map((product, index) => {
      const id = Number(product.id);
      const name = escapeHtml(product.name);
      const emoji = escapeHtml(product.emoji || '✦');
      const badge = escapeHtml(product.badge || 'تجريبي');
      const badgeType = ['hot', 'rare'].includes(product.badgeType) ? product.badgeType : '';
      const category = escapeHtml(CATEGORY_LABELS[product.category] || 'منتج');
      const description = escapeHtml(product.description);
      const price = formatPrice(Number(product.price));
      return `
        <article class="product-card stagger-${Math.min(index, 8)}">
          <div class="product-visual category-${escapeHtml(product.category)}">
            <span class="product-badge ${badgeType}">${badge}</span>
            <span class="product-glow" aria-hidden="true"></span>
            <span class="product-emoji" aria-hidden="true">${emoji}</span>
          </div>
          <div class="product-content">
            <div class="product-meta"><span class="product-category">${category}</span><span class="product-reference">BD-${String(id).padStart(3, '0')}</span></div>
            <h3 class="product-title">${name}</h3>
            <p class="product-description">${description}</p>
            <div class="product-footer">
              <div class="product-price"><strong>${price}</strong><small>سعر توضيحي</small></div>
              <div class="product-actions">
                <button class="details-button" type="button" data-details="${id}" aria-label="تفاصيل ${name}" title="التفاصيل">↗</button>
                <button class="add-button" type="button" data-add="${id}" aria-label="إضافة ${name} إلى السلة" title="أضف إلى السلة">+</button>
              </div>
            </div>
          </div>
        </article>`;
    }).join('');

    $('emptyState').hidden = products.length !== 0;
    productGrid.hidden = products.length === 0;
    $('activeFilters').hidden = !(state.query || state.category !== 'all');
    $('resultCount').textContent = `${products.length} ${products.length === 1 ? 'منتج' : 'منتجات'}`;
    $('allCount').textContent = String(state.products.filter(p => p.active !== false).length).padStart(2, '0');
  }

  function cartTotals() {
    return Object.entries(state.cart).reduce((total, [id, quantity]) => {
      const product = state.products.find((item) => Number(item.id) === Number(id) && item.active !== false);
      if (product && Number.isSafeInteger(quantity) && quantity > 0) {
        total.count += quantity;
        total.amount += Number(product.price) * quantity;
      }
      return total;
    }, { count: 0, amount: 0 });
  }

  function renderCart() {
    // Remove items that no longer exist or are disabled in the live catalog.
    for (const id of Object.keys(state.cart)) {
      if (!state.products.some(p => Number(p.id) === Number(id) && p.active !== false)) delete state.cart[id];
    }
    persistCart();
    const totals = cartTotals();
    $('cartCount').textContent = totals.count;
    $('drawerCount').textContent = `${totals.count} ${totals.count === 1 ? 'عنصر' : 'عناصر'}`;
    $('cartTotal').textContent = formatPrice(totals.amount);
    $('checkoutCount').textContent = totals.count;
    $('checkoutTotal').textContent = formatPrice(totals.amount);

    $('cartItems').innerHTML = Object.entries(state.cart).map(([id, quantity]) => {
      const product = state.products.find(p => Number(p.id) === Number(id));
      if (!product) return '';
      const name = escapeHtml(product.name);
      return `
        <div class="cart-line">
          <div class="cart-line-art" aria-hidden="true">${escapeHtml(product.emoji || '✦')}</div>
          <div>
            <div class="cart-line-title">${name}</div>
            <div class="cart-line-price">${formatPrice(Number(product.price) * quantity)}</div>
            <div class="quantity-control">
              <button type="button" data-qty="${product.id}" data-delta="-1" aria-label="تقليل كمية ${name}">−</button>
              <span aria-label="الكمية">${quantity}</span>
              <button type="button" data-qty="${product.id}" data-delta="1" aria-label="زيادة كمية ${name}">+</button>
            </div>
          </div>
          <button class="remove-line" type="button" data-remove="${product.id}" aria-label="حذف ${name}" title="حذف">×</button>
        </div>`;
    }).join('');

    const hasItems = totals.count > 0;
    $('cartEmpty').hidden = hasItems;
    $('cartItems').hidden = !hasItems;
    $('drawerFooter').hidden = !hasItems;
  }

  function openOverlay(which) {
    state.previousFocus = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add('overlay-open');
    if (which === 'cart') {
      cartDrawer.hidden = false;
      $('closeCart').focus();
    } else if (which === 'product') {
      productDialog.hidden = false;
      $('dialogAddToCart').focus();
    } else if (which === 'checkout') {
      checkoutDialog.hidden = false;
      $('playerId').focus();
    }
  }

  function closeOverlays() {
    cartDrawer.hidden = true;
    productDialog.hidden = true;
    checkoutDialog.hidden = true;
    overlay.hidden = true;
    document.body.classList.remove('overlay-open');
    state.activeProduct = null;
    if (state.previousFocus && typeof state.previousFocus.focus === 'function') state.previousFocus.focus();
  }

  function showCart() {
    renderCart();
    openOverlay('cart');
  }

  function addToCart(id) {
    const product = state.products.find(p => Number(p.id) === Number(id) && p.active !== false);
    if (!product) return toast('هذا العنصر غير متاح حاليًا.', 'error');
    const current = Number(state.cart[id] || 0);
    if (current >= 20) return toast('الحد التجريبي للكمية هو 20 لكل عنصر.', 'error');
    state.cart[id] = current + 1;
    renderCart();
    const count = $('cartCount');
    count.classList.remove('bump');
    void count.offsetWidth;
    count.classList.add('bump');
    toast(`أُضيف «${product.name}» إلى السلة التجريبية.`);
  }

  function showProduct(id) {
    const product = state.products.find(p => Number(p.id) === Number(id) && p.active !== false);
    if (!product) return toast('تعذر العثور على تفاصيل هذا العنصر.', 'error');
    state.activeProduct = product;
    $('dialogProductCategory').textContent = CATEGORY_LABELS[product.category] || 'منتج';
    $('dialogProductName').textContent = product.name;
    $('dialogProductDescription').textContent = product.description;
    $('dialogProductPrice').textContent = formatPrice(Number(product.price));
    $('dialogProductEmoji').textContent = product.emoji || '✦';
    $('dialogProductArt').className = `dialog-product-art category-${product.category}`;
    openOverlay('product');
  }

  function setCategory(category) {
    state.category = category;
    categoryButtons.forEach((button) => {
      const active = button.dataset.filter === category;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderProducts();
  }

  function resetCatalog() {
    state.category = 'all';
    state.query = '';
    state.sort = 'featured';
    $('searchInput').value = '';
    $('sortSelect').value = 'featured';
    setCategory('all');
    $('shop').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  async function loadCatalog() {
    productGrid.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/products', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('catalog-unavailable');
      const result = await response.json();
      if (Array.isArray(result.products) && result.products.length) {
        state.products = result.products.filter(p => p && Number.isSafeInteger(Number(p.id)) && Number(p.price) >= 0);
        renderProducts();
        renderCart();
      }
    } catch {
      // Keep the bundled demonstration catalog available when opened offline.
    } finally {
      productGrid.setAttribute('aria-busy', 'false');
    }
  }

  function setupRevealAnimations() {
    const items = [...document.querySelectorAll('.reveal')];
    if (reducedMotion || !('IntersectionObserver' in window)) {
      items.forEach(item => item.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          currentObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    items.forEach(item => observer.observe(item));
  }

  function setupNavigation() {
    const menuButton = $('mobileMenuToggle');
    const nav = $('primaryNav');
    menuButton.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('is-open');
      menuButton.setAttribute('aria-expanded', String(isOpen));
      menuButton.setAttribute('aria-label', isOpen ? 'إغلاق قائمة التنقل' : 'فتح قائمة التنقل');
    });
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      menuButton.setAttribute('aria-expanded', 'false');
    }));

    const navLinks = [...nav.querySelectorAll('a')];
    const sections = navLinks.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
    if ('IntersectionObserver' in window && !reducedMotion) {
      const activeObserver = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        navLinks.forEach(link => link.classList.toggle('is-active', link.getAttribute('href') === `#${visible.target.id}`));
      }, { rootMargin: '-22% 0px -62% 0px', threshold: [0, 0.2, 0.5] });
      sections.forEach(section => activeObserver.observe(section));
    }
  }

  function focusSearch() {
    $('searchInput').focus();
    $('shop').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  async function submitDemoOrder(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const playerId = $('playerId').value.trim();
    const totals = cartTotals();
    if (totals.count < 1) {
      closeOverlays();
      return toast('أضف عنصرًا واحدًا على الأقل قبل المعاينة.', 'error');
    }
    if (playerId && !/^[0-9]{6,16}$/.test(playerId)) {
      $('playerId').setCustomValidity('أدخل من 6 إلى 16 رقمًا أو اترك الحقل فارغًا.');
      $('playerId').reportValidity();
      return;
    }
    $('playerId').setCustomValidity('');

    const button = $('submitOrder');
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = 'جارٍ إنشاء المعاينة…';
    if (!state.idempotencyKey) state.idempotencyKey = makeIdempotencyKey();
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Idempotency-Key': state.idempotencyKey
        },
        body: JSON.stringify({
          playerId,
          items: Object.entries(state.cart).map(([id, quantity]) => ({ productId: Number(id), quantity }))
        })
      });
      const data = await response.json().catch(() => ({ ok: false, error: 'تعذر قراءة نتيجة الخادم.' }));
      if (!response.ok || !data.ok) throw new Error(data.error || 'تعذر إكمال المعاينة.');

      const reference = data.order?.reference || 'DEMO';
      state.cart = {};
      state.idempotencyKey = null;
      persistCart();
      renderCart();
      form.reset();
      closeOverlays();
      toast(`تم إنشاء طلب تجريبي ${reference}. لم يتم الدفع أو الشحن.`);
    } catch (error) {
      // Keep the idempotency key for a safe retry after network errors.
      toast(error.message || 'تعذر الاتصال بالخادم. جرّب مرة أخرى.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  function makeIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'bd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
  }

  function trapFocus(event) {
    if (event.key !== 'Tab' || overlay.hidden) return;
    const activeDialog = !checkoutDialog.hidden ? checkoutDialog : !productDialog.hidden ? productDialog : !cartDrawer.hidden ? cartDrawer : null;
    if (!activeDialog) return;
    const focusable = [...activeDialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  productGrid.addEventListener('click', event => {
    const add = event.target.closest('[data-add]');
    const details = event.target.closest('[data-details]');
    if (add) addToCart(add.dataset.add);
    if (details) showProduct(details.dataset.details);
  });

  categoryButtons.forEach(button => button.addEventListener('click', () => setCategory(button.dataset.filter)));
  document.querySelectorAll('[data-category-jump]').forEach(button => button.addEventListener('click', () => {
    setCategory(button.dataset.categoryJump);
    $('shop').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  }));

  $('searchInput').addEventListener('input', event => { state.query = event.target.value.trim(); renderProducts(); });
  $('sortSelect').addEventListener('change', event => { state.sort = event.target.value; renderProducts(); });
  $('clearFilters').addEventListener('click', resetCatalog);
  $('resetCatalog').addEventListener('click', resetCatalog);
  $('focusSearch').addEventListener('click', focusSearch);
  $('openCart').addEventListener('click', showCart);
  $('closeCart').addEventListener('click', closeOverlays);
  $('browseCatalog').addEventListener('click', () => { closeOverlays(); $('shop').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' }); });
  $('checkoutButton').addEventListener('click', () => {
    if (!cartTotals().count) return toast('سلتك فارغة.', 'error');
    state.idempotencyKey = makeIdempotencyKey();
    openOverlay('checkout');
  });
  $('checkoutForm').addEventListener('submit', submitDemoOrder);
  $('playerId').addEventListener('input', () => $('playerId').setCustomValidity(''));
  $('dialogAddToCart').addEventListener('click', () => {
    if (state.activeProduct) addToCart(state.activeProduct.id);
    closeOverlays();
  });
  document.querySelectorAll('[data-close-dialog], [data-close-checkout]').forEach(button => button.addEventListener('click', closeOverlays));
  overlay.addEventListener('click', closeOverlays);
  productDialog.addEventListener('click', event => { if (event.target === productDialog) closeOverlays(); });
  checkoutDialog.addEventListener('click', event => { if (event.target === checkoutDialog) closeOverlays(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) closeOverlays();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); focusSearch(); }
    trapFocus(event);
  });

  $('year').textContent = new Date().getFullYear();
  setupRevealAnimations();
  setupNavigation();
  renderProducts();
  renderCart();
  loadCatalog();
})();
