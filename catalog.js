/* One demo catalog shared by the browser and Node.js server. */
(function exposeCatalog(root, factory) {
  const items = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = items;
  else root.BlueDropCatalog = items;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCatalog() {
  return [
    { id: 1, slug: 'diamond-starter-100', category: 'diamonds', name: 'باقة 100 جوهرة', description: 'باقة بداية تجريبية بتصميم أزرق أنيق.', price: 250, currency: 'DZD', emoji: '💎', badge: 'للبداية', badgeType: 'hot', featured: 1, active: true },
    { id: 2, slug: 'diamond-plus-310', category: 'diamonds', name: 'باقة 310 جواهر', description: 'اختيار متوسط ضمن كتالوج المعاينة.', price: 650, currency: 'DZD', emoji: '💠', badge: 'اختيار مميز', badgeType: '', featured: 2, active: true },
    { id: 3, slug: 'diamond-max-520', category: 'diamonds', name: 'باقة 520 جوهرة', description: 'باقة أكبر في تجربة عرض المنتجات.', price: 990, currency: 'DZD', emoji: '💎', badge: 'باقة كبيرة', badgeType: '', featured: 3, active: true },
    { id: 4, slug: 'reward-card-demo', category: 'codes', name: 'بطاقة مكافأة تجريبية', description: 'بطاقة توضيحية لفئة الأكواد الرقمية.', price: 180, currency: 'DZD', emoji: '🎟️', badge: 'تجريبي', badgeType: '', featured: 4, active: true },
    { id: 5, slug: 'surprise-crate-demo', category: 'codes', name: 'صندوق المفاجآت', description: 'بطاقة عرض توضيحية بتصميم خاص.', price: 320, currency: 'DZD', emoji: '🎁', badge: 'مميز', badgeType: 'hot', featured: 5, active: true },
    { id: 6, slug: 'blue-neon-skin-demo', category: 'skins', name: 'سكن النيون الأزرق', description: 'تصميم رمزي لفئة السكنات في النموذج.', price: 1200, currency: 'DZD', emoji: '🧥', badge: 'نادر بصريًا', badgeType: 'rare', featured: 6, active: true },
    { id: 7, slug: 'warrior-set-demo', category: 'skins', name: 'حزمة المحارب', description: 'عرض مرئي توضيحي لعشاق المظاهر.', price: 850, currency: 'DZD', emoji: '🛡️', badge: 'مجموعة', badgeType: '', featured: 7, active: true },
    { id: 8, slug: 'celebration-emote-demo', category: 'emotes', name: 'رقصة الاحتفال', description: 'عنصر توضيحي لفئة الرقصات.', price: 450, currency: 'DZD', emoji: '🕺', badge: 'جديد', badgeType: '', featured: 8, active: true }
  ];
});
