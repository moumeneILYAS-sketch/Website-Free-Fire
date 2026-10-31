(() => {
  'use strict';

  const CATEGORY_LABELS = Object.freeze({
    diamonds: 'الجواهر',
    codes: 'الأكواد وبطاقات الهدايا',
    skins: 'الأزياء والمظاهر',
    emotes: 'الرقصات',
    memberships: 'العضويات الأسبوعية والشهرية',
    passes: 'Booyah Pass',
    characters: 'الشخصيات',
    pets: 'الحيوانات الأليفة',
    accessories: 'الإكسسوارات والمظاهر',
    profiles: 'الملف الشخصي والرموز'
  });
  const STORAGE_KEY = 'bluedrop.cart.v2';
  const LANGUAGE_STORAGE_KEY = 'bluedrop.language.mode.v1';
  const $ = (id) => document.getElementById(id);
  const tr = (value) => window.BlueDropI18n
    ? window.BlueDropI18n.translate(value, activeLanguage())
    : String(value ?? '');
  const activeLocale = () => window.BlueDropI18n
    ? window.BlueDropI18n.locale(activeLanguage())
    : 'ar-DZ';
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
    toastTimer: null,
    googleEnabled: false,
    googleReady: false,
    googleCsrfToken: '',
    googleNonce: '',
    googleUser: null,
    walletCountry: 'DZ',
    languageMode: 'auto'
  };

  const WALLET_COUNTRIES = Object.freeze({
    DZ: { name: 'الجزائر', currency: 'DZD', locale: 'ar-DZ', methods: ['البطاقة الذهبية (EDAHABIA)', 'بطاقة CIB', 'بطاقات البنوك الجزائرية الأخرى (حسب دعم بوابة الدفع)'] },
    MA: { name: 'المغرب', currency: 'MAD', locale: 'ar-MA', methods: ['بطاقات محلية عبر CMI', 'Visa / Mastercard حسب البنك'] },
    TN: { name: 'تونس', currency: 'TND', locale: 'ar-TN', methods: ['البطاقات البنكية المحلية عبر مزوّد معتمد'] },
    EG: { name: 'مصر', currency: 'EGP', locale: 'ar-EG', methods: ['بطاقة Meeza', 'Visa / Mastercard حسب البنك'] },
    SA: { name: 'السعودية', currency: 'SAR', locale: 'ar-SA', methods: ['مدى (mada)', 'Visa / Mastercard'] },
    AE: { name: 'الإمارات', currency: 'AED', locale: 'ar-AE', methods: ['البطاقات البنكية المحلية', 'Visa / Mastercard', 'Apple Pay / Google Pay عند دعم المزوّد'] },
    FR: { name: 'فرنسا', currency: 'EUR', locale: 'fr-FR', methods: ['Carte bancaire', 'تحويل SEPA باليورو'] },
    DE: { name: 'ألمانيا', currency: 'EUR', locale: 'de-DE', methods: ['البطاقات البنكية', 'تحويل SEPA باليورو'] },
    GB: { name: 'المملكة المتحدة', currency: 'GBP', locale: 'en-GB', methods: ['البطاقات البنكية', 'التحويل البنكي المحلي'] },
    US: { name: 'الولايات المتحدة', currency: 'USD', locale: 'en-US', methods: ['البطاقات البنكية', 'التحويل المصرفي عبر مزوّد معتمد'] }
  });
  const WALLET_COUNTRY_STORAGE = 'bluedrop.wallet.country.v2';

  function detectWalletCountry() {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const zoneMap = {
      'Africa/Algiers': 'DZ', 'Africa/Casablanca': 'MA', 'Africa/Tunis': 'TN',
      'Africa/Cairo': 'EG', 'Asia/Riyadh': 'SA', 'Asia/Dubai': 'AE',
      'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/London': 'GB',
      'America/New_York': 'US', 'America/Chicago': 'US', 'America/Los_Angeles': 'US'
    };
    if (zoneMap[zone]) return zoneMap[zone];
    const locale = String(navigator.language || '').toUpperCase();
    const region = locale.match(/[-_]([A-Z]{2})(?:$|[-_])/);
    return region && WALLET_COUNTRIES[region[1]] ? region[1] : 'DZ';
  }

  function readWalletCountry() {
    try {
      const saved = localStorage.getItem(WALLET_COUNTRY_STORAGE);
      if (saved && WALLET_COUNTRIES[saved]) return saved;
    } catch { /* Storage may be disabled. */ }
    return detectWalletCountry();
  }

  state.walletCountry = readWalletCountry();

  function readLanguageMode() {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      return ['auto', 'ar', 'fr', 'en', 'de'].includes(saved) ? saved : 'auto';
    } catch { return 'auto'; }
  }

  function languageForCountry(countryCode) {
    const map = {
      DZ: 'ar', MA: 'ar', TN: 'ar', EG: 'ar', SA: 'ar', AE: 'ar',
      FR: 'fr', DE: 'de', GB: 'en', US: 'en'
    };
    return map[countryCode] || 'en';
  }

  function activeLanguage() {
    return state.languageMode === 'auto'
      ? languageForCountry(state.walletCountry)
      : state.languageMode;
  }

  state.languageMode = readLanguageMode();

  function applyLanguagePreference() {
    const language = activeLanguage();
    if (window.BlueDropI18n) window.BlueDropI18n.apply(language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    $('languageSelect').value = state.languageMode;
    renderProducts();
    renderCart();
    updateWalletCountryUI();
    updatePaymentMethodNotice();
  }

  function changeLanguageMode(mode) {
    if (!['auto', 'ar', 'fr', 'en', 'de'].includes(mode)) return;
    state.languageMode = mode;
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, mode); } catch { /* Keep the choice for this session. */ }
    applyLanguagePreference();
  }

  function walletMoney(amount, countryCode) {
    const config = WALLET_COUNTRIES[countryCode] || WALLET_COUNTRIES.DZ;
    try {
      return new Intl.NumberFormat(activeLocale(), {
        style: 'currency', currency: config.currency, maximumFractionDigits: 2
      }).format(amount);
    } catch {
      return `0 ${config.currency}`;
    }
  }

  function updateWalletCountryUI() {
    const config = WALLET_COUNTRIES[state.walletCountry] || WALLET_COUNTRIES.DZ;
    const select = $('walletCountrySelect');
    if (select) select.value = state.walletCountry;
    $('walletBalance').textContent = '0';
    $('walletBalance').title = `${tr('رصيد المحفظة')}: ${walletMoney(0, state.walletCountry)}`;
    $('walletPanelBalance').textContent = walletMoney(0, state.walletCountry);
    $('walletCurrencyLabel').textContent = `${tr(config.name)} • ${config.currency}`;
    $('walletPaymentMethods').innerHTML = config.methods.map(method =>
      `<span class="wallet-method-chip">${escapeHtml(tr(method))}</span>`
    ).join('');
    updateWalletDepositPreview();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function commissionPercent(countryCode = state.walletCountry) {
    return window.BlueDropCommission
      ? window.BlueDropCommission.resolvePercent({ countryCode })
      : 2;
  }

  function commissionQuote(baseAmount, countryCode = state.walletCountry, decimals = 0) {
    if (window.BlueDropCommission) {
      return window.BlueDropCommission.calculate(baseAmount, { countryCode, decimals });
    }
    const basePrice = Math.max(0, Number(baseAmount) || 0);
    const commissionAmount = Math.round(basePrice * 0.02 * (10 ** decimals)) / (10 ** decimals);
    return { basePrice, commissionPercent: 2, commissionAmount, finalPrice: basePrice + commissionAmount };
  }

  function formatPrice(value) {
    return new Intl.NumberFormat(activeLocale(), {
      style: 'currency', currency: 'DZD', maximumFractionDigits: 0
    }).format(value);
  }

  function formatWalletAmount(value, countryCode = state.walletCountry) {
    return walletMoney(value, countryCode);
  }

  function updateWalletDepositPreview() {
    const input = $('walletDepositAmount');
    if (!input) return;
    const amount = Number(input.value);
    const currency = (WALLET_COUNTRIES[state.walletCountry] || WALLET_COUNTRIES.DZ).currency;
    const percent = commissionPercent();
    const valid = Number.isFinite(amount) && amount > 0 && amount <= 10000000;
    const quote = valid
      ? commissionQuote(amount, state.walletCountry, currency === 'DZD' ? 0 : 2)
      : commissionQuote(0, state.walletCountry, currency === 'DZD' ? 0 : 2);
    $('walletDepositFee').textContent = formatWalletAmount(quote.commissionAmount);
    $('walletDepositTotal').textContent = formatWalletAmount(quote.finalPrice);
    $('walletDepositPreviewNotice').textContent = valid
      ? tr('رسوم خدمة تقديرية فقط؛ لا يتم تحصيل المبلغ ولا زيادة الرصيد.')
      : tr('أدخل مبلغًا موجبًا لمعاينة العمولة والإجمالي.');
    $('walletCommissionRate').textContent = `${tr('عمولة خدمة BlueDrop')}: ${percent}%`;
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
    node.textContent = tr(message);
    node.dataset.kind = kind;
    node.classList.add('show');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => node.classList.remove('show'), 3100);
  }

  function updateGoogleAccountUI() {
    const button = $('googleSignInFallback');
    const controls = $('googleUserControls');
    const hint = $('googleAuthHint');
    const name = $('googleAccountName');

    if (state.googleUser) {
      button.hidden = true;
      controls.hidden = false;
      $('walletDropdown').hidden = false;
      name.textContent = state.googleUser.name || state.googleUser.email || tr('حساب Google');
      updateWalletCountryUI();
      hint.textContent = tr('تم تسجيل الدخول');
      return;
    }

    controls.hidden = true;
    $('walletDropdown').hidden = true;
    $('walletDropdown').open = false;
    button.hidden = false;
    button.disabled = !state.googleEnabled || !state.googleReady;
    button.title = state.googleReady
      ? tr('تسجيل الدخول باستخدام Google')
      : tr('تسجيل Google قيد الإعداد');
    hint.textContent = state.googleEnabled ? tr('تسجيل آمن عبر Google') : tr('تسجيل Google قيد الإعداد');
  }

  function loadGoogleIdentityScript() {
    if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.getElementById('google-identity-services');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.id = 'google-identity-services';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('تعذر تحميل خدمة Google.'));
      document.head.appendChild(script);
    });
  }

  async function bootstrapGoogleAuth() {
    try {
      const response = await fetch('/api/auth/google', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'تعذر إعداد تسجيل Google.');
      state.googleEnabled = Boolean(data.enabled);
      state.googleReady = false;
      state.googleCsrfToken = data.csrfToken || '';
      state.googleNonce = data.nonce || '';
      state.googleUser = data.user || null;
      updateGoogleAccountUI();
      if (!state.googleEnabled || state.googleUser) return;

      await loadGoogleIdentityScript();
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        throw new Error('خدمة Google غير متاحة في هذا المتصفح.');
      }

      window.google.accounts.id.initialize({
        client_id: data.clientId,
        nonce: state.googleNonce,
        callback: handleGoogleCredential,
        auto_select: false,
        ux_mode: 'popup'
      });

      // The visible control is our frameless Google logo; One Tap opens only after a click.
      state.googleReady = true;
      updateGoogleAccountUI();
    } catch (error) {
      state.googleReady = false;
      $('googleAuthHint').textContent = tr(error.message || 'تسجيل Google غير متاح الآن');
      updateGoogleAccountUI();
    }
  }

  function startGoogleSignIn() {
    if (!state.googleEnabled || !state.googleReady || !window.google?.accounts?.id) {
      toast('خدمة تسجيل Google ما زالت تُحمّل. حاول بعد لحظة.', 'error');
      return;
    }

    try {
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed()) {
          toast('لم تتمكن Google من عرض نافذة الحساب. تحقق من إعدادات المتصفح وحاول مجددًا.', 'error');
        } else if (notification.isSkippedMoment()) {
          toast('لم يتم اختيار حساب Google. اضغط الشعار للمحاولة مرة أخرى.', 'error');
        }
      });
    } catch (error) {
      toast(error.message || 'تعذر فتح تسجيل Google الآن.', 'error');
    }
  }

  async function handleGoogleCredential(result) {
    if (!result || typeof result.credential !== 'string' || !state.googleCsrfToken) {
      return toast('تعذر بدء جلسة Google. حدّث الصفحة وحاول مجددًا.', 'error');
    }
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-BlueDrop-CSRF': state.googleCsrfToken
        },
        body: JSON.stringify({ credential: result.credential })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'تعذر تسجيل الدخول.');
      state.googleUser = data.user;
      toast('تم تسجيل الدخول بحساب Google.');
      await bootstrapGoogleAuth();
    } catch (error) {
      toast(error.message || 'تعذر التحقق من حساب Google.', 'error');
      await bootstrapGoogleAuth();
    }
  }

  async function signOutGoogle() {
    if (!state.googleCsrfToken) return bootstrapGoogleAuth();
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-BlueDrop-CSRF': state.googleCsrfToken
        },
        body: JSON.stringify({ action: 'logout' })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'تعذر تسجيل الخروج.');
      state.googleUser = null;
      toast('تم تسجيل الخروج.');
      await bootstrapGoogleAuth();
    } catch (error) {
      toast(tr(error.message || 'تعذر تسجيل الخروج.'), 'error');
    }
  }

  const PAYMENT_METHOD_NOTICES = Object.freeze({
    edahabia: 'البطاقة الذهبية غير متصلة بعد. سيتم ربط بوابة معتمدة لاحقًا؛ هذا الاختيار تجريبي فقط.',
    cib: 'بطاقة CIB غير متصلة بعد. سيتم ربط بوابة معتمدة لاحقًا؛ لا تفتح هذه المعاينة صفحة دفع.',
    visa: 'Visa غير مفعّلة. يجب تأكيد أهلية التاجر ودعم مزود الدفع قبل تفعيلها. لا تدخل بيانات البطاقة.',
    mastercard: 'Mastercard غير مفعّلة. يجب تأكيد أهلية التاجر ودعم مزود الدفع قبل تفعيلها. لا تدخل بيانات البطاقة.',
    paypal: 'PayPal غير مربوط بحساب تاجر. هذا الاختيار للمعاينة فقط ولا يتم تحويل أموال.',
    baridimob: 'BaridiMob: لن نطلب تحويلًا أو إيصالًا الآن. لاحقًا يمكن عرض تعليمات رسمية ومراجعة يدوية بعد التحقق من وصول الدفعة.',
    other_bank: 'يمكن للعميل تحديد بنك آخر ضمن الطلب. هذا تسجيل لتفضيل وسيلة الدفع فقط؛ لا توجد بوابة متصلة ولا يتم تحصيل الأموال.'
  });

  function selectedPaymentMethod() {
    return document.querySelector('input[name="paymentMethod"]:checked')?.value || 'edahabia';
  }

  function updatePaymentMethodNotice() {
    const method = selectedPaymentMethod();
    const notice = $('paymentMethodNotice');
    notice.dataset.method = method;
    notice.textContent = tr(PAYMENT_METHOD_NOTICES[method] || 'طريقة دفع تجريبية فقط.');
  }

  function currentProducts() {
    const query = state.query.toLocaleLowerCase(activeLocale());
    const result = state.products.filter((product) => {
      if (product.active === false) return false;
      const matchesCategory = state.category === 'all' || product.category === state.category;
      const searchable = [product.name, tr(product.name), product.description, tr(product.description),
        CATEGORY_LABELS[product.category] || '', tr(CATEGORY_LABELS[product.category] || ''), product.slug || ''].join(' ');
      return matchesCategory && searchable.toLocaleLowerCase(activeLocale()).includes(query);
    });

    if (state.sort === 'low') result.sort((a, b) => a.price - b.price);
    else if (state.sort === 'high') result.sort((a, b) => b.price - a.price);
    else if (state.sort === 'name') result.sort((a, b) => tr(a.name).localeCompare(tr(b.name), activeLocale()));
    else result.sort((a, b) => (a.featured ?? a.id) - (b.featured ?? b.id));
    return result;
  }

  function renderProducts() {
    const products = currentProducts();
    productGrid.setAttribute('aria-busy', 'false');
    productGrid.innerHTML = products.map((product, index) => {
      const id = Number(product.id);
      const name = escapeHtml(tr(product.name));
      const emoji = escapeHtml(product.emoji || '✦');
      const badge = escapeHtml(tr(product.badge || 'تجريبي'));
      const badgeType = ['hot', 'rare'].includes(product.badgeType) ? product.badgeType : '';
      const category = escapeHtml(tr(CATEGORY_LABELS[product.category] || 'منتج'));
      const description = escapeHtml(tr(product.description));
      const isGiftCard = Number.isFinite(Number(product.faceValue)) && Boolean(product.faceCurrency);
      const isOfficialDiamondTopup = product.category === 'diamonds';
      const productQuote = !isGiftCard && !product.priceDisplay
        ? commissionQuote(Number(product.price), state.walletCountry)
        : null;
      const price = isGiftCard
        ? `${Number(product.faceValue)} ${escapeHtml(product.faceCurrency)}`
        : product.priceDisplay
          ? escapeHtml(tr(product.priceDisplay))
          : formatPrice(productQuote.finalPrice);
      const priceNote = isOfficialDiamondTopup
        ? `${tr('سعر استرشادي • السعر النهائي لدى Garena')} • ${tr('يشمل عمولة خدمة')} ${productQuote.commissionPercent}%`
        : isGiftCard
          ? `${tr('قيمة اسمية •')} ${escapeHtml(tr(product.regionLabel || 'منطقة محددة'))}`
          : productQuote
            ? product.priceNote
              ? `${escapeHtml(tr(product.priceNote))} • ${tr('يشمل عمولة خدمة')} ${productQuote.commissionPercent}%`
              : `${tr('يشمل عمولة خدمة')} ${productQuote.commissionPercent}%`
            : escapeHtml(tr(product.priceNote || 'للعرض فقط'));
      const cartButton = isOfficialDiamondTopup
        ? `<a class="add-button official-purchase-link" href="https://pagostore.garena.com/" target="_blank" rel="noopener noreferrer" aria-label="${tr('فتح قناة Garena الرسمية لشحن')} ${name}" title="${tr('افتح PagoStore الرسمي')}">↗</a>`
        : product.purchasable === false
          ? `<button class="add-button" type="button" disabled aria-label="${name} — ${tr('غير متاح للشراء')}" title="${tr('للعرض فقط')}">—</button>`
          : `<button class="add-button" type="button" data-add="${id}" aria-label="${tr('إضافة')} ${name} ${tr('إلى السلة')}" title="${tr('أضف إلى السلة')}">+</button>`;
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
              <div class="product-price"><strong>${price}</strong><small>${priceNote}</small></div>
              <div class="product-actions">
                <button class="details-button" type="button" data-details="${id}" aria-label="${tr('تفاصيل')} ${name}" title="التفاصيل">↗</button>
                ${cartButton}
              </div>
            </div>
          </div>
        </article>`;
    }).join('');

    $('emptyState').hidden = products.length !== 0;
    productGrid.hidden = products.length === 0;
    $('activeFilters').hidden = !(state.query || state.category !== 'all');
    $('resultCount').textContent = `${new Intl.NumberFormat(activeLocale()).format(products.length)} ${tr(products.length === 1 ? 'منتج' : 'منتجات')}`;
    $('allCount').textContent = String(state.products.filter(p => p.active !== false).length).padStart(2, '0');
  }

  function cartTotals() {
    const totals = Object.entries(state.cart).reduce((total, [id, quantity]) => {
      const product = state.products.find((item) => Number(item.id) === Number(id) && item.active !== false && item.purchasable !== false);
      if (product && Number.isSafeInteger(quantity) && quantity > 0) {
        const lineSubtotal = Number(product.price) * quantity;
        const lineQuote = commissionQuote(lineSubtotal, state.walletCountry);
        total.count += quantity;
        total.subtotal += lineSubtotal;
        total.commission += lineQuote.commissionAmount;
        total.amount += lineQuote.finalPrice;
      }
      return total;
    }, { count: 0, subtotal: 0, commission: 0, amount: 0 });
    return { ...totals, commissionPercent: commissionPercent() };
  }

  function renderCart() {
    // Remove items that no longer exist or are disabled in the live catalog.
    for (const id of Object.keys(state.cart)) {
      if (!state.products.some(p => Number(p.id) === Number(id) && p.active !== false && p.purchasable !== false)) delete state.cart[id];
    }
    persistCart();
    const totals = cartTotals();
    $('cartCount').textContent = totals.count;
    $('drawerCount').textContent = `${new Intl.NumberFormat(activeLocale()).format(totals.count)} ${tr(totals.count === 1 ? 'عنصر' : 'عناصر')}`;
    $('cartSubtotal').textContent = formatPrice(totals.subtotal);
    $('cartCommissionLabel').textContent = `${tr('عمولة خدمة BlueDrop')} (${totals.commissionPercent}%)`;
    $('cartCommissionTotal').textContent = formatPrice(totals.commission);
    $('cartTotal').textContent = formatPrice(totals.amount);
    $('checkoutCount').textContent = totals.count;
    $('checkoutSubtotal').textContent = formatPrice(totals.subtotal);
    $('checkoutCommissionLabel').textContent = `${tr('عمولة خدمة BlueDrop')} (${totals.commissionPercent}%)`;
    $('checkoutCommission').textContent = formatPrice(totals.commission);
    $('checkoutTotal').textContent = formatPrice(totals.amount);

    $('cartItems').innerHTML = Object.entries(state.cart).map(([id, quantity]) => {
      const product = state.products.find(p => Number(p.id) === Number(id));
      if (!product) return '';
      const name = escapeHtml(tr(product.name));
      return `
        <div class="cart-line">
          <div class="cart-line-art" aria-hidden="true">${escapeHtml(product.emoji || '✦')}</div>
          <div>
            <div class="cart-line-title">${name}</div>
            <div class="cart-line-price">${formatPrice(commissionQuote(Number(product.price) * quantity, state.walletCountry).finalPrice)}</div>
            <div class="quantity-control">
              <button type="button" data-qty="${product.id}" data-delta="-1" aria-label="${tr('تقليل كمية')} ${name}">−</button>
              <span aria-label="الكمية">${quantity}</span>
              <button type="button" data-qty="${product.id}" data-delta="1" aria-label="${tr('زيادة كمية')} ${name}">+</button>
            </div>
          </div>
          <button class="remove-line" type="button" data-remove="${product.id}" aria-label="${tr('حذف')} ${name}" title="${tr('حذف')}">×</button>
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
      const officialLink = $('dialogOfficialTopupLink');
      const action = $('dialogAddToCart');
      (officialLink && !officialLink.hidden ? officialLink : action.disabled ? productDialog.querySelector('.dialog-close') : action).focus();
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
    if (product.purchasable === false) return toast('هذه البطاقة للعرض فقط، والشراء والتسليم غير متاحين حاليًا.', 'error');
    const current = Number(state.cart[id] || 0);
    if (current >= 20) return toast('الحد التجريبي للكمية هو 20 لكل عنصر.', 'error');
    state.cart[id] = current + 1;
    renderCart();
    const count = $('cartCount');
    count.classList.remove('bump');
    void count.offsetWidth;
    count.classList.add('bump');
    toast(`${tr('تمت إضافة المنتج إلى السلة التجريبية.')}: ${tr(product.name)}`);
  }

  function showProduct(id) {
    const product = state.products.find(p => Number(p.id) === Number(id) && p.active !== false);
    if (!product) return toast('تعذر العثور على تفاصيل هذا العنصر.', 'error');
    state.activeProduct = product;
    $('dialogProductCategory').textContent = tr(CATEGORY_LABELS[product.category] || 'منتج');
    $('dialogProductName').textContent = tr(product.name);
    $('dialogProductDescription').textContent = tr(product.description);
    const isGiftCard = Number.isFinite(Number(product.faceValue)) && Boolean(product.faceCurrency);
    const productQuote = !isGiftCard && !product.priceDisplay
      ? commissionQuote(Number(product.price), state.walletCountry)
      : null;
    $('dialogProductPrice').textContent = isGiftCard
      ? `${Number(product.faceValue)} ${product.faceCurrency}`
      : (product.priceDisplay ? tr(product.priceDisplay) : formatPrice(productQuote.finalPrice));
    const isOfficialDiamondTopup = product.category === 'diamonds';
    $('dialogPriceNote').textContent = isOfficialDiamondTopup
      ? `${tr('سعر استرشادي • السعر النهائي والباقة المتاحة يظهران في Garena')} • ${tr('يشمل عمولة خدمة')} ${productQuote.commissionPercent}%`
      : isGiftCard
        ? `${tr('قيمة اسمية •')} ${tr(product.regionLabel || 'منطقة محددة')} — ${tr('للعرض فقط')}`
        : productQuote
          ? `${tr(product.priceNote || 'سعر توضيحي')} • ${tr('يشمل عمولة خدمة')} ${productQuote.commissionPercent}%`
          : tr(product.priceNote || 'للعرض فقط');
    const addButton = $('dialogAddToCart');
    const officialLink = $('dialogOfficialTopupLink');
    officialLink.hidden = !isOfficialDiamondTopup;
    addButton.hidden = isOfficialDiamondTopup;
    addButton.disabled = product.purchasable === false;
    addButton.textContent = tr(product.purchasable === false ? 'للعرض فقط — غير متاح للشراء' : 'أضف إلى السلة');
    $('dialogProductNote').textContent = tr(isOfficialDiamondTopup
      ? 'سيتم فتح PagoStore الرسمي من Garena. اختر الباقة المتاحة لبلدك وتحقق من السعر قبل الدفع، واستعن بولي أمرك.'
      : 'عنصر للعرض فقط — لا يوجد مورد رسمي مؤكد أو تسليم من BlueDrop.');
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
    const paymentMethod = selectedPaymentMethod();
    const totals = cartTotals();
    if (totals.count < 1) {
      closeOverlays();
      return toast('أضف عنصرًا واحدًا على الأقل قبل المعاينة.', 'error');
    }
    if (playerId && !/^[0-9]{6,16}$/.test(playerId)) {
      $('playerId').setCustomValidity(tr('أدخل من 6 إلى 16 رقمًا أو اترك الحقل فارغًا.'));
      $('playerId').reportValidity();
      return;
    }
    $('playerId').setCustomValidity('');

    const button = $('submitOrder');
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = tr('جارٍ إنشاء المعاينة…');
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
          paymentMethod,
          countryCode: state.walletCountry,
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
      updatePaymentMethodNotice();
      closeOverlays();
      toast(`${tr('تم إنشاء طلب تجريبي')} ${reference}. ${tr('لم يتم الدفع أو الشحن.')}`);
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

  // Delegated cart controls keep working after every renderCart() refresh.
  $('cartItems').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      const id = String(remove.dataset.remove);
      const product = state.products.find(item => Number(item.id) === Number(id));
      if (!Object.hasOwn(state.cart, id)) return;
      delete state.cart[id];
      state.idempotencyKey = null;
      renderCart();
      toast(product ? `${tr('تم حذف المنتج من السلة.')}: ${tr(product.name)}` : 'تم حذف المنتج من السلة.');
      return;
    }

    const quantityButton = event.target.closest('[data-qty]');
    if (!quantityButton) return;
    const id = String(quantityButton.dataset.qty);
    const current = Number(state.cart[id] || 0);
    const delta = Number(quantityButton.dataset.delta);
    if (!Number.isSafeInteger(delta) || ![-1, 1].includes(delta) || current < 1) return;

    const nextQuantity = current + delta;
    if (nextQuantity <= 0) {
      delete state.cart[id];
    } else if (nextQuantity <= 20) {
      state.cart[id] = nextQuantity;
    } else {
      return toast('الحد الأقصى للكمية هو 20 لكل منتج.', 'error');
    }
    state.idempotencyKey = null;
    renderCart();
  });

  $('clearCartButton').addEventListener('click', () => {
    if (!Object.keys(state.cart).length) return;
    const confirmed = window.confirm(tr('إلغاء الطلبية وإفراغ السلة؟'));
    if (!confirmed) return;
    state.cart = {};
    state.idempotencyKey = null;
    persistCart();
    renderCart();
    toast('تم إلغاء الطلبية وإفراغ السلة.');
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
    if (!cartTotals().count) return toast(tr('سلتك فارغة.'), 'error');
    state.idempotencyKey = makeIdempotencyKey();
    openOverlay('checkout');
  });
  $('checkoutForm').addEventListener('submit', submitDemoOrder);
  document.querySelectorAll('input[name="paymentMethod"]').forEach(input => input.addEventListener('change', updatePaymentMethodNotice));
  $('bankLinkInfoButton').addEventListener('click', () => {
    const info = $('bankLinkInfo');
    const opening = info.hidden;
    info.hidden = !opening;
    $('bankLinkInfoButton').setAttribute('aria-expanded', String(opening));
    $('bankLinkInfoButton').textContent = tr(opening ? 'إخفاء شرح الربط' : 'كيف يعمل الربط الآمن؟');
  });
  $('googleSignInFallback').addEventListener('click', startGoogleSignIn);
  $('googleSignOut').addEventListener('click', signOutGoogle);
  $('languageSelect').addEventListener('change', event => changeLanguageMode(event.target.value));
  $('walletCountrySelect').addEventListener('change', event => {
    const country = event.target.value;
    if (!WALLET_COUNTRIES[country]) return;
    state.walletCountry = country;
    try { localStorage.setItem(WALLET_COUNTRY_STORAGE, country); } catch { /* Keep the choice for this page session. */ }
    if (state.languageMode === 'auto') applyLanguagePreference();
    else {
      updateWalletCountryUI();
      renderProducts();
      renderCart();
    }
  });
  $('walletDepositAmount').addEventListener('input', updateWalletDepositPreview);
  $('walletDepositButton').addEventListener('click', () => {
    updateWalletDepositPreview();
    const amount = Number($('walletDepositAmount').value);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('أدخل مبلغًا موجبًا لمعاينة العمولة والإجمالي.', 'error');
      return;
    }
    toast('هذه معاينة رسوم فقط؛ لم يتم تحصيل أي مبلغ ولم يتغير رصيد المحفظة.');
  });
  document.addEventListener('click', event => {
    const dropdown = $('walletDropdown');
    if (dropdown && !dropdown.contains(event.target)) dropdown.open = false;
  });
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
  applyLanguagePreference();
  setupRevealAnimations();
  setupNavigation();
  renderProducts();
  renderCart();
  loadCatalog();
  updatePaymentMethodNotice();
  bootstrapGoogleAuth();
})();
