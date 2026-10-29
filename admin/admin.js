(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const categories = {diamonds:'الجواهر',codes:'الأكواد',skins:'السكنات',emotes:'الرقصات'};
  let toastTimer;

  function showToast(message, error = false) {
    const node = $('adminToast');
    node.textContent = message;
    node.classList.toggle('error', error);
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 3200);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) }
    });
    const result = await response.json().catch(() => ({ok:false,error:'تعذر قراءة استجابة الخادم.'}));
    if (!response.ok || !result.ok) throw new Error(result.error || 'تعذر إكمال العملية.');
    return result;
  }

  function renderProducts(products) {
    $('productsBody').innerHTML = products.map(product => `
      <tr>
        <td><div class="product-cell"><span class="product-emoji">${escapeHtml(product.emoji || '✦')}</span><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.slug)}</small></span></div></td>
        <td>${escapeHtml(categories[product.category] || product.category)}</td>
        <td>${new Intl.NumberFormat('ar-DZ').format(Number(product.price))} د.ج</td>
        <td><span class="status-pill ${product.active === false ? 'off' : ''}">${product.active === false ? 'موقوف' : 'نشط'}</span></td>
        <td><button class="row-action" type="button" data-price="${Number(product.id)}" data-current-price="${Number(product.price)}">تعديل السعر</button><button class="row-action ${product.active === false ? '' : 'danger'}" type="button" data-active="${Number(product.id)}" data-value="${product.active !== false}">${product.active === false ? 'تفعيل' : 'إيقاف'}</button></td>
      </tr>`).join('') || '<tr><td colspan="5">لا توجد منتجات.</td></tr>';
  }

  function renderOrders(orders) {
    $('ordersBody').innerHTML = orders.map(order => `
      <tr><td><strong>${escapeHtml(order.reference)}</strong></td><td>${Number(order.itemCount)}</td><td>${new Intl.NumberFormat('ar-DZ').format(Number(order.total))} د.ج</td><td><span class="status-pill off">تجريبي — غير منفّذ</span></td><td>${escapeHtml(new Date(order.createdAt).toLocaleString('ar-DZ'))}</td></tr>`).join('') || '<tr><td colspan="5">لا توجد طلبات تجريبية بعد.</td></tr>';
  }

  async function refresh() {
    $('adminStatus').textContent = 'جارٍ التحديث…';
    try {
      const [overview, products, orders] = await Promise.all([
        api('/api/admin/overview'), api('/api/admin/products'), api('/api/admin/orders')
      ]);
      $('adminStats').innerHTML = `
        <div class="stat-card"><small>حالة قاعدة البيانات</small><strong class="accent">${overview.database ? 'متصلة' : 'غير مُهيأة'}</strong></div>
        <div class="stat-card"><small>عدد المنتجات</small><strong>${products.products.length}</strong></div>
        <div class="stat-card"><small>طلبات التجربة</small><strong>${Number(overview.orderCount)}</strong></div>`;
      renderProducts(products.products);
      renderOrders(orders.orders);
      $('catalogNotice').textContent = overview.database ? 'المنتجات محفوظة في PostgreSQL. المدفوعات والتسليم الحقيقيان ما زالا غير مفعّلين.' : 'هذه معاينة مؤقتة في الذاكرة. لتعديل دائم، أعد إعداد PostgreSQL ثم شغّل ترحيل قاعدة البيانات.';
      $('adminStatus').textContent = 'تم التحديث';
    } catch (error) {
      $('adminStatus').textContent = 'تعذر الاتصال';
      $('productsBody').innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
      $('ordersBody').innerHTML = '<tr><td colspan="5">تعذر تحميل البيانات.</td></tr>';
      showToast(error.message, true);
    }
  }

  $('refreshDashboard').addEventListener('click', refresh);
  $('toggleNewProduct').addEventListener('click', () => { $('newProductForm').hidden = !$('newProductForm').hidden; });
  $('cancelNewProduct').addEventListener('click', () => $('newProductForm').hidden = true);

  $('newProductForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const product = {
      name: String(data.get('name') || '').trim(),
      slug: String(data.get('slug') || '').trim(),
      category: String(data.get('category') || ''),
      description: String(data.get('description') || '').trim(),
      price: Number(data.get('price')),
      emoji: String(data.get('emoji') || '✦').trim(),
      badge: String(data.get('badge') || 'تجريبي').trim()
    };
    try {
      await api('/api/admin/products', {method:'POST',body:JSON.stringify(product)});
      form.reset();
      $('newProductForm').hidden = true;
      showToast('تمت إضافة المنتج.');
      await refresh();
    } catch (error) { showToast(error.message, true); }
  });

  $('productsBody').addEventListener('click', async event => {
    const activeButton = event.target.closest('[data-active]');
    const priceButton = event.target.closest('[data-price]');
    try {
      if (activeButton) {
        const currentlyActive = activeButton.dataset.value === 'true';
        await api(`/api/admin/products/${Number(activeButton.dataset.active)}`, {method:'PATCH',body:JSON.stringify({active:!currentlyActive})});
        showToast(currentlyActive ? 'تم إيقاف المنتج.' : 'تم تفعيل المنتج.');
        await refresh();
      } else if (priceButton) {
        const current = Number(priceButton.dataset.currentPrice);
        const value = window.prompt('أدخل السعر الجديد بالدينار الجزائري (عدد صحيح):', String(current));
        if (value === null) return;
        if (!/^\d+$/.test(value.trim()) || Number(value) < 1 || Number(value) > 100000000) {
          showToast('أدخل سعرًا صحيحًا موجبًا.', true);
          return;
        }
        await api(`/api/admin/products/${Number(priceButton.dataset.price)}`, {method:'PATCH',body:JSON.stringify({price:Number(value)})});
        showToast('تم تحديث السعر.');
        await refresh();
      }
    } catch (error) { showToast(error.message, true); }
  });

  refresh();
})();
