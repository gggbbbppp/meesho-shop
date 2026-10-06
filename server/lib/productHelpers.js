// Ported from the scraped app.js window.ProductHelpers, so category/size/
// delivery-estimate logic behaves identically server-side.

// This catalog turned out to be 100% apparel (no actual jewellery items),
// so categorization is based on garment style/cut rather than the jewellery
// taxonomy the original site's helper had (which was dead code for this data).
const STYLE_KEYWORDS = [
  'Anarkali', 'Angrakha Style', 'Sharara Suit', 'Nayra Cut', 'Straight Fit',
  'A-Line', 'Flared', 'Kurta & Pants', 'Designer Fit', 'Party Wear',
  'Casual Wear', 'Festive Special',
];
const COMBO_RE = /combo|pack of|set of\s*\d|\d\s*-?\s*pcs|pcs set/i;

export function getCategory(titleOrProduct) {
  if (titleOrProduct && typeof titleOrProduct === 'object') {
    if (titleOrProduct.category) return titleOrProduct.category;
    titleOrProduct = titleOrProduct.title;
  }
  const title = String(titleOrProduct || '');
  if (/clutch|purse|bag|handbag|marrige|marriage/i.test(title)) return 'Marrige Purse';
  if (COMBO_RE.test(title)) return 'Combos & Sets';
  return STYLE_KEYWORDS.find((s) => title.includes(s)) || 'Marrige Purse';
}

export function getSizes(productOrTitle) {
  if (productOrTitle && typeof productOrTitle === 'object' && Array.isArray(productOrTitle.sizes) && productOrTitle.sizes.length > 0) {
    return productOrTitle.sizes;
  }
  return ['S', 'M', 'L', 'XL', 'XXL'];
}

export function estimateDelivery(pincode) {
  if (!/^\d{6}$/.test(String(pincode).trim())) return null;
  const day = 3 + (parseInt(String(pincode).slice(-2), 10) % 4);
  const d = new Date();
  d.setDate(d.getDate() + day);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
