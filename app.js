(() => {
  "use strict";
  const products = [
    {id:1,category:"diamonds",name:"باقة 100 جوهرة",description:"باقة بداية بتصميم تجريبي أنيق.",price:250,emoji:"💎",badge:"الأكثر طلبًا",badgeType:"hot",featured:1},
    {id:2,category:"diamonds",name:"باقة 310 جواهر",description:"خيار متوسط لعشاق الجواهر.",price:650,emoji:"💠",badge:"قيمة مميزة",badgeType:"",featured:2},
    {id:3,category:"diamonds",name:"باقة 520 جوهرة",description:"باقة كبيرة ضمن نموذج المتجر.",price:990,emoji:"💎",badge:"باقة كبيرة",badgeType:"",featured:3},
    {id:4,category:"codes",name:"بطاقة كود مكافأة",description:"عنصر توضيحي لعرض الأكواد الرقمية.",price:180,emoji:"🎟️",badge:"تجريبي",badgeType:"",featured:4},
    {id:5,category:"codes",name:"صندوق المفاجآت",description:"بطاقة عرض تجريبية بتصميم مميز.",price:320,emoji:"🎁",badge:"مميز",badgeType:"hot",featured:5},
    {id:6,category:"skins",name:"سكن النيون الأزرق",description:"تصميم رمزي لفئة السكنات النادرة.",price:1200,emoji:"🧥",badge:"نادر",badgeType:"rare",featured:6},
    {id:7,category:"skins",name:"حزمة المحارب",description:"عرض بصري تجريبي لعشاق المظاهر.",price:850,emoji:"🛡️",badge:"مميز",badgeType:"",featured:7},
    {id:8,category:"emotes",name:"رقصة الاحتفال",description:"عنصر توضيحي لفئة الرقصات.",price:450,emoji:"🕺",badge:"جديد",badgeType:"",featured:8}
  ];
  const labels = {diamonds:"الجواهر",codes:"الأكواد",skins:"السكنات",emotes:"الرقصات"};
  const state = {filter:"all",search:"",sort:"featured",cart:{}};
  const $ = id => document.getElementById(id);
  const grid = $("productGrid"), cartDrawer = $("cartDrawer");
  const formatPrice = n => new Intl.NumberFormat("ar-DZ").format(n) + " د.ج";
  let toastTimer;

  function toast(message) {
    const node = $("toast");
    node.textContent = message;
    node.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.classList.remove("show"), 2800);
  }

  function visibleProducts() {
    const query = state.search.toLocaleLowerCase();
    const list = products.filter(p =>
      (state.filter === "all" || p.category === state.filter) &&
      (p.name + " " + p.description + " " + labels[p.category]).toLocaleLowerCase().includes(query)
    );
    if (state.sort === "low") list.sort((a,b) => a.price-b.price);
    else if (state.sort === "high") list.sort((a,b) => b.price-a.price);
    else list.sort((a,b) => a.featured-b.featured);
    return list;
  }

  function renderProducts() {
    const list = visibleProducts();
    grid.innerHTML = list.map(p =>
      '<article class="product-card">' +
        '<div class="visual"><span class="badge ' + p.badgeType + '">' + p.badge + '</span>' +
        '<span class="glow"></span><span class="product-emoji" aria-hidden="true">' + p.emoji + '</span></div>' +
        '<div class="product-content"><span class="category">' + labels[p.category] + '</span>' +
        '<h3 class="product-title">' + p.name + '</h3><p class="product-desc">' + p.description + '</p>' +
        '<div class="product-bottom"><div class="price"><strong>' + formatPrice(p.price) +
        '</strong><small>سعر تجريبي</small></div><button class="add" data-add="' + p.id +
        '" type="button" aria-label="إضافة ' + p.name + ' إلى السلة">+</button></div></div></article>'
    ).join("");
    $("emptyState").hidden = list.length !== 0;
    grid.hidden = list.length === 0;
  }

  function cartTotals() {
    return Object.entries(state.cart).reduce((acc, [id, qty]) => {
      const p = products.find(item => item.id === Number(id));
      if (p) { acc.count += qty; acc.total += p.price * qty; }
      return acc;
    }, {count:0,total:0});
  }

  function renderCart() {
    const totals = cartTotals();
    $("cartCount").textContent = totals.count;
    $("drawerItemCount").textContent = "(" + totals.count + ")";
    $("cartTotal").textContent = formatPrice(totals.total);
    $("checkoutCount").textContent = totals.count;
    $("checkoutTotal").textContent = formatPrice(totals.total);
    $("cartItems").innerHTML = Object.entries(state.cart).filter(([,qty]) => qty > 0).map(([id,qty]) => {
      const p = products.find(item => item.id === Number(id));
      if (!p) return "";
      return '<div class="cart-line"><div class="cart-emoji" aria-hidden="true">' + p.emoji +
        '</div><div><div class="cart-line-title">' + p.name + '</div><div class="cart-line-price">' +
        formatPrice(p.price * qty) + '</div><div class="quantity"><button type="button" data-qty="' + p.id +
        '" data-delta="-1" aria-label="تقليل الكمية">−</button><span>' + qty +
        '</span><button type="button" data-qty="' + p.id +
        '" data-delta="1" aria-label="زيادة الكمية">+</button></div></div><button class="remove" data-remove="' +
        p.id + '" type="button" aria-label="حذف ' + p.name + '">×</button></div>';
    }).join("");
    const hasItems = totals.count > 0;
    $("cartEmpty").hidden = hasItems;
    $("cartItems").hidden = !hasItems;
    $("drawerFooter").hidden = !hasItems;
  }

  function openCart() {
    cartDrawer.hidden = false;
    $("drawerBackdrop").hidden = false;
    document.body.classList.add("no-scroll");
    $("closeCart").focus();
  }

  function closeCart() {
    cartDrawer.hidden = true;
    $("drawerBackdrop").hidden = true;
    document.body.classList.remove("no-scroll");
    $("openCart").focus();
  }

  function openCheckout() {
    if (cartTotals().count === 0) {
      toast("أضف عنصرًا واحدًا على الأقل إلى السلة.");
      return;
    }
    $("checkoutBackdrop").hidden = false;
    $("playerId").focus();
  }

  function closeCheckout() { $("checkoutBackdrop").hidden = true; }

  grid.addEventListener("click", event => {
    const button = event.target.closest("[data-add]");
    if (!button) return;
    const id = Number(button.dataset.add);
    state.cart[id] = (state.cart[id] || 0) + 1;
    renderCart();
    toast("تمت إضافة العنصر إلى السلة التجريبية.");
  });

  document.querySelectorAll("[data-filter]").forEach(button =>
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach(b =>
        b.classList.toggle("active", b === button)
      );
      renderProducts();
    })
  );

  $("searchInput").addEventListener("input", event => {
    state.search = event.target.value.trim();
    renderProducts();
  });

  $("sortSelect").addEventListener("change", event => {
    state.sort = event.target.value;
    renderProducts();
  });

  $("clearFilters").addEventListener("click", () => {
    state.filter = "all";
    state.search = "";
    $("searchInput").value = "";
    document.querySelectorAll("[data-filter]").forEach(b =>
      b.classList.toggle("active", b.dataset.filter === "all")
    );
    renderProducts();
  });

  $("openCart").addEventListener("click", openCart);
  $("closeCart").addEventListener("click", closeCart);
  $("drawerBackdrop").addEventListener("click", closeCart);
  $("browseProducts").addEventListener("click", () => {
    closeCart();
    $("shop").scrollIntoView({behavior:"smooth"});
  });

  $("cartItems").addEventListener("click", event => {
    const remove = event.target.closest("[data-remove]");
    const quantity = event.target.closest("[data-qty]");
    if (remove) {
      delete state.cart[Number(remove.dataset.remove)];
      renderCart();
      return;
    }
    if (quantity) {
      const id = Number(quantity.dataset.qty);
      state.cart[id] = (state.cart[id] || 0) + Number(quantity.dataset.delta);
      if (state.cart[id] <= 0) delete state.cart[id];
      renderCart();
    }
  });

  $("checkoutButton").addEventListener("click", openCheckout);
  $("closeCheckout").addEventListener("click", closeCheckout);
  $("checkoutBackdrop").addEventListener("click", event => {
    if (event.target === $("checkoutBackdrop")) closeCheckout();
  });

  $("checkoutForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const playerId = $("playerId").value.trim();
    if (!/^[0-9]{6,16}$/.test(playerId)) {
      toast("تحقق من معرّف اللاعب: من 6 إلى 16 رقمًا.");
      return;
    }
    if (!["http:", "https:"].includes(window.location.protocol)) {
      closeCheckout();
      closeCart();
      toast("نجح اختبار الواجهة فقط — لم يتم إنشاء طلب حقيقي أو شحن الحساب.");
      form.reset();
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "جارٍ إرسال الطلب التجريبي…";
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {"Content-Type":"application/json","Accept":"application/json"},
        body: JSON.stringify({
          playerId,
          items: Object.entries(state.cart).map(([id, quantity]) => ({
            productId:Number(id), quantity
          }))
        })
      });
      const result = await response.json().catch(() => ({
        ok:false, error:"خدمة الطلبات غير متاحة. شغّل المشروع عبر npm start."
      }));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "تعذّر إنشاء الطلب التجريبي.");
      }
      state.cart = {};
      renderCart();
      closeCheckout();
      closeCart();
      form.reset();
      toast("تم إنشاء طلب تجريبي " + result.order.reference + " — لم يتم الدفع أو الشحن.");
    } catch (error) {
      toast(error.message || "تعذّر الاتصال بخدمة الطلبات التجريبية. تأكد من تشغيل الخادم.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "عرض نتيجة الاختبار";
    }
  });

  function loadServerCatalog() {
    if (!["http:","https:"].includes(window.location.protocol)) return;
    fetch("/api/products", {headers:{"Accept":"application/json"}})
      .then(response => {
        if (!response.ok) throw new Error("Catalog unavailable");
        return response.json();
      })
      .then(data => {
        if (!Array.isArray(data.products) || !data.products.length) return;
        products.splice(0, products.length, ...data.products);
        renderProducts();
        renderCart();
      })
      .catch(() => {/* Keep the local demo catalogue if the API is unavailable. */});
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if (!$("checkoutBackdrop").hidden) closeCheckout();
      else if (!cartDrawer.hidden) closeCart();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("searchInput").focus();
      $("shop").scrollIntoView({behavior:"smooth"});
    }
  });

  $("year").textContent = new Date().getFullYear();
  renderProducts();
  renderCart();
  loadServerCatalog();
})();
