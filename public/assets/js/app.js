/* =====================================================
   MEESHO CLONE — app.js (server-backed rewrite)
   Same public API as the original (Cart, DeliveryAddress, Order,
   CartDrawer, PaymentVerify, ProductHelpers, $, $$, navigate, ...) so every
   existing page's inline script keeps working unchanged. The difference:
   state is now persisted server-side (SQLite, keyed by a session cookie)
   instead of localStorage, and checkout is a MOCK order creation — there is
   no payment gateway call anywhere in this file.
   ===================================================== */

/* ─────────────────────────────────────────────
   PRODUCT CATALOG (fetched once from the backend)
   ───────────────────────────────────────────── */
window.PRODUCTS = [];
window.ProductsReady = fetch('/api/products?pageSize=500')
  .then((r) => r.json())
  .then((data) => {
    window.PRODUCTS = data.items;
    return window.PRODUCTS;
  })
  .catch((err) => {
    console.error('Failed to load products', err);
    return [];
  });

/* ─────────────────────────────────────────────
   CART STATE (server-backed, optimistic locally)
   Business rule: at most one line item, quantity 1, priced ₹299 or less.
   ───────────────────────────────────────────── */
window.Cart = (() => {
  function getMaxOrderValue() {
    if (window.SITE_SETTINGS && window.SITE_SETTINGS.max_order_amount) {
      const parsed = parseFloat(window.SITE_SETTINGS.max_order_amount);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 299;
  }
  const MAX_ITEM_QUANTITY = 1;

  let items = [];
  let listeners = [];

  function fromServer(cart) {
    items = cart.items.map((i) => ({
      id: i.id, title: i.title, image: i.image, price: i.price, mrp: i.mrp,
      size: i.size, quantity: i.quantity, seller: i.seller, easyReturns: i.easyReturns,
    }));
  }

  const ready = fetch('/api/cart').then((r) => r.json()).then((cart) => {
    fromServer(cart);
    notify();
    return items;
  }).catch((err) => {
    console.error('Failed to load cart', err);
    return items;
  });

  function notify() {
    listeners.forEach((fn) => fn(items));
    updateAllBadges();
  }

  function lineKey(id, size) { return `${id}-${size}`; }

  // Re-syncs from the server and re-renders — used when an optimistic update
  // turns out to have been rejected (e.g. a race with another tab).
  function resync() {
    fetch('/api/cart').then((r) => r.json()).then((cart) => { fromServer(cart); notify(); });
  }

  return {
    ready,
    getItems() { return [...items]; },
    getMaxOrderValue,
    getTotals() {
      const totalItems = items.reduce((s, i) => s + i.quantity, 0);
      const totalPrice = items.reduce((s, i) => s + i.price * i.quantity, 0);
      const totalMrp = items.reduce((s, i) => s + i.mrp * i.quantity, 0);
      return { totalItems, totalPrice, totalMrp };
    },
    addItem(item) {
      const maxOrderValue = getMaxOrderValue();
      if (item.price > maxOrderValue) {
        alert(`This item is priced above the ₹${maxOrderValue} order limit and can't be added.`);
        return false;
      }

      const key = lineKey(item.id, item.size);
      if (items.some((i) => lineKey(i.id, i.size) === key)) {
        alert(`Maximum quantity per order is ${MAX_ITEM_QUANTITY}.`);
        return false;
      }
      if (items.length > 0) {
        alert('Only one item is allowed in your cart at a time. Remove the current item to add a different one.');
        return false;
      }

      items.push({ ...item, quantity: 1 });
      notify();

      fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: item.id, size: item.size }),
      }).then((r) => {
        if (!r.ok) throw new Error('rejected');
        return r.json();
      }).then((cart) => { fromServer(cart); notify(); })
        .catch((err) => { console.error('addItem sync failed', err); resync(); });

      return true;
    },
    removeItem(id, size) {
      const key = lineKey(id, size);
      items = items.filter((i) => lineKey(i.id, i.size) !== key);
      notify();

      fetch(`/api/cart/${id}/${encodeURIComponent(size)}`, { method: 'DELETE' })
        .then((r) => r.json()).then((cart) => { fromServer(cart); notify(); })
        .catch((err) => console.error('removeItem sync failed', err));
    },
    updateQuantity(id, size, qty) {
      const key = lineKey(id, size);
      const idx = items.findIndex((i) => lineKey(i.id, i.size) === key);
      if (idx < 0) return false;

      if (qty > MAX_ITEM_QUANTITY) {
        alert(`Maximum quantity per order is ${MAX_ITEM_QUANTITY}.`);
        return false;
      }

      if (qty <= 0) {
        items = items.filter((i) => lineKey(i.id, i.size) !== key);
      } else {
        items[idx].quantity = qty;
      }
      notify();

      fetch(`/api/cart/${id}/${encodeURIComponent(size)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty }),
      }).then((r) => {
        if (!r.ok) throw new Error('rejected');
        return r.json();
      }).then((cart) => { fromServer(cart); notify(); })
        .catch((err) => { console.error('updateQuantity sync failed', err); resync(); });

      return true;
    },
    clearCart() {
      items = [];
      notify();
      fetch('/api/cart', { method: 'DELETE' }).catch(() => {});
    },
    isInCart(id) { return items.some((i) => i.id === id); },
    onChange(fn) { listeners.push(fn); },
    reload() {
      return fetch('/api/cart')
        .then((r) => r.json())
        .then((cart) => {
          fromServer(cart);
          notify();
          return items;
        })
        .catch((err) => {
          console.error('Failed to reload cart', err);
          return items;
        });
    },
  };
})();

/* ─────────────────────────────────────────────
   WISHLIST (server-backed, optimistic locally)
   ───────────────────────────────────────────── */
window.Wishlist = (() => {
  let ids = new Set();
  let listeners = [];

  function paintButton(btn) {
    const id = Number(btn.dataset.wishId);
    const active = ids.has(id);
    btn.classList.toggle('active', active);
    const svg = btn.querySelector('svg');
    if (svg) {
      svg.style.fill = active ? '#9f2089' : 'none';
      svg.style.stroke = active ? '#9f2089' : (btn.dataset.wishStroke || 'currentColor');
    }
  }

  function paintAll() {
    document.querySelectorAll('.wish-toggle-btn').forEach(paintButton);
  }

  function notify() {
    listeners.forEach((fn) => fn(ids));
    paintAll();
  }

  const ready = fetch('/api/wishlist').then((r) => r.json()).then((data) => {
    ids = new Set(data.items.map((p) => p.id));
    notify();
    return ids;
  }).catch((err) => {
    console.error('Failed to load wishlist', err);
    return ids;
  });

  return {
    ready,
    has(id) { return ids.has(Number(id)); },
    getIds() { return [...ids]; },
    async toggle(id) {
      id = Number(id);
      const wasActive = ids.has(id);
      if (wasActive) ids.delete(id); else ids.add(id);
      notify();

      try {
        const res = await fetch(`/api/wishlist/${id}`, { method: wasActive ? 'DELETE' : 'POST' });
        if (!res.ok) throw new Error('sync failed');
      } catch (err) {
        if (wasActive) ids.add(id); else ids.delete(id);
        notify();
      }
    },
    async remove(id) {
      id = Number(id);
      ids.delete(id);
      notify();
      try { await fetch(`/api/wishlist/${id}`, { method: 'DELETE' }); } catch (err) { /* ignore */ }
    },
    onChange(fn) { listeners.push(fn); },
    bindAll: paintAll,
  };
})();

// Stops the click from reaching an ancestor <a class="product-card"> (etc.)
// before toggling — must run at the button itself, not via document
// delegation, since anchors here navigate via their own onclick handler.
function toggleWish(event, id) {
  event.preventDefault();
  event.stopPropagation();
  window.Wishlist.toggle(id);
}

/* ─────────────────────────────────────────────
   DELIVERY ADDRESS (server-backed)
   ───────────────────────────────────────────── */
window.DeliveryAddress = (() => {
  let cached = null;

  const ready = fetch('/api/address').then((r) => r.json()).then((a) => { cached = a; return a; })
    .catch(() => null);

  return {
    ready,
    async save(addr) {
      const res = await fetch('/api/address', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addr),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save address');
      }
      cached = await res.json();
      return cached;
    },
    load() { return cached; },
    format(a) {
      const line = [a.houseNo, a.roadArea, a.city].filter(Boolean).join(', ');
      return `${line}, ${a.state} - ${a.pincode}`;
    },
    estimatedDelivery() {
      const d = new Date(); d.setDate(d.getDate() + 5);
      return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short' });
    },
    reload() {
      return fetch('/api/address')
        .then((r) => r.json())
        .then((a) => { cached = a; return a; })
        .catch(() => null);
    },
  };
})();

/* ─────────────────────────────────────────────
   ORDERS (server-backed; no payment gateway involved)
   ───────────────────────────────────────────── */
window.Order = {
  cache: null,
  async placeOrder() {
    const res = await fetch('/api/orders', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to place order');
    }
    this.cache = await res.json();
    return this.cache;
  },
  async get(orderId) {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
    if (!res.ok) return null;
    return res.json();
  },
  load() { return this.cache; },
};

/* ─────────────────────────────────────────────
   PAYU HOSTED CHECKOUT
   ───────────────────────────────────────────── */
window.PayUCheckout = {
  async initiate() {
    const res = await fetch('/api/payu/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to initiate PayU checkout');
    }
    const data = await res.json();
    if (!data.action || !data.params) {
      throw new Error('Invalid PayU checkout response');
    }

    // Create a hidden form and submit it to redirect to PayU Hosted Checkout
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = data.action;
    form.style.display = 'none';

    for (const [key, value] of Object.entries(data.params)) {
      if (value !== undefined && value !== null) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
      }
    }

    document.body.appendChild(form);
    form.submit();
  },
};

/* ─────────────────────────────────────────────
   PAYMENT METHODS (PayU Hosted Gateway)
   ───────────────────────────────────────────── */
window.PaymentConfig = {
  PAYMENT_APPS: [
    {
      id: 'payu',
      label: 'PayU Payment Gateway (Recommended)',
      logoBg: '#10846d',
      initial: 'P',
      subtitle: 'Instant & 100% Secure · UPI, Cards, NetBanking, QR Code',
      badge: 'SECURE'
    },
    {
      id: 'gpay',
      label: 'Google Pay (via PayU)',
      logoBg: '#4285f4',
      initial: 'G',
      subtitle: 'Pay via Google Pay on PayU Checkout'
    },
    {
      id: 'phonepe',
      label: 'PhonePe (via PayU)',
      logoBg: '#5f259f',
      initial: 'Pe',
      subtitle: 'Pay via PhonePe on PayU Checkout'
    },
    {
      id: 'paytm',
      label: 'Paytm (via PayU)',
      logoBg: '#00baf2',
      initial: 'Pt',
      subtitle: 'Pay via Paytm on PayU Checkout'
    },
  ],
  DISABLED_OPTIONS: [
    { id: 'cod', label: 'Cash on Delivery (Unavailable — Prepaid Only Offer)' },
  ],
};

/* ─────────────────────────────────────────────
   PRODUCT DATA HELPERS
   ───────────────────────────────────────────── */
const STYLE_KEYWORDS = [
  'Anarkali', 'Angrakha Style', 'Sharara Suit', 'Nayra Cut', 'Straight Fit',
  'A-Line', 'Flared', 'Kurta & Pants', 'Designer Fit', 'Party Wear',
  'Casual Wear', 'Festive Special',
];
const COMBO_RE = /combo|pack of|set of\s*\d|\d\s*-?\s*pcs|pcs set/i;

window.ProductHelpers = {
  getCategory(titleOrProduct) {
    if (titleOrProduct && typeof titleOrProduct === 'object') {
      if (titleOrProduct.category) return titleOrProduct.category;
      titleOrProduct = titleOrProduct.title;
    }
    const title = String(titleOrProduct || '');
    if (/clutch|purse|bag|handbag|marrige|marriage/i.test(title)) return 'Marrige Purse';
    if (COMBO_RE.test(title)) return 'Combos & Sets';
    return STYLE_KEYWORDS.find((s) => title.includes(s)) || 'Marrige Purse';
  },
  getSizes(productOrTitle) {
    if (productOrTitle && typeof productOrTitle === 'object') {
      if (Array.isArray(productOrTitle.sizes) && productOrTitle.sizes.length > 0) {
        return productOrTitle.sizes;
      }
    } else if (typeof productOrTitle === 'number' || (typeof productOrTitle === 'string' && !isNaN(productOrTitle))) {
      const found = window.ProductHelpers.getById(productOrTitle);
      if (found && Array.isArray(found.sizes) && found.sizes.length > 0) {
        return found.sizes;
      }
    }
    // Check global settings configured from admin panel
    if (window.SITE_SETTINGS && window.SITE_SETTINGS.default_sizes) {
      const parsed = window.SITE_SETTINGS.default_sizes.split(',').map((s) => s.trim()).filter(Boolean);
      if (parsed.length > 0) return parsed;
    }
    return ['S', 'M', 'L', 'XL', 'XXL'];
  },
  estimateDelivery(pincode) {
    if (!/^\d{6}$/.test(pincode.trim())) return null;
    const day = 3 + (parseInt(pincode.slice(-2), 10) % 4);
    const d = new Date(); d.setDate(d.getDate() + day);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  },
  getById(id) {
    return (window.PRODUCTS || []).find((p) => p.id === Number(id));
  },
  getPage(page, pageSize = 10) {
    const all = window.PRODUCTS || [];
    const start = (page - 1) * pageSize;
    return { items: all.slice(start, start + pageSize), hasMore: start + pageSize < all.length, total: all.length };
  },
};

/* ─────────────────────────────────────────────
   DEAL TIMER HELPER
   ───────────────────────────────────────────── */
window.hasDealTimer = (id) => {
  const p = window.ProductHelpers.getById(id);
  return !!(p && p.dealTimer);
};

/* ─────────────────────────────────────────────
   CART BADGE UPDATER (all pages)
   ───────────────────────────────────────────── */
function updateAllBadges() {
  const { totalItems } = window.Cart.getTotals();
  document.querySelectorAll('.cart-badge:not(.wishlist-badge)').forEach((el) => {
    el.textContent = totalItems;
    el.style.display = totalItems > 0 ? 'flex' : 'none';
  });

  const wishCount = window.Wishlist.getIds().length;
  document.querySelectorAll('.wishlist-badge').forEach((el) => {
    el.textContent = wishCount;
    el.style.display = wishCount > 0 ? 'flex' : 'none';
  });
}

/* ─────────────────────────────────────────────
   CART DRAWER (product detail page)
   ───────────────────────────────────────────── */
window.CartDrawer = {
  ensureMarkup() {
    if (!document.getElementById('cart-drawer')) {
      const overlay = document.createElement('div');
      overlay.id = 'cart-drawer-overlay';
      overlay.className = 'cart-drawer-overlay';
      overlay.onclick = () => window.CartDrawer.close();

      const drawer = document.createElement('aside');
      drawer.id = 'cart-drawer';
      drawer.className = 'cart-drawer';
      drawer.setAttribute('aria-label', 'Shopping Cart Drawer');
      drawer.innerHTML = `
        <div class="cart-drawer-header">
          <div style="display:flex;align-items:center;gap:.5rem">
            <h3 style="font-size:1rem;font-weight:700;color:#1e293b;margin:0">My Cart</h3>
            <span id="drawer-item-count" style="font-size:.75rem;color:var(--muted-foreground)">0 Items</span>
          </div>
          <button onclick="CartDrawer.close()" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--muted-foreground)" aria-label="Close Cart">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div id="drawer-items-list" class="cart-drawer-items"></div>
        <div id="drawer-footer" class="cart-drawer-footer">
          <div style="display:flex;flex-direction:column;gap:.375rem;margin-bottom:1rem">
            <div class="price-row" style="display:flex;justify-content:space-between;font-size:.875rem;color:#475569">
              <span>Total MRP</span>
              <span id="drawer-mrp">₹0</span>
            </div>
            <div class="price-row" style="display:flex;justify-content:space-between;font-size:.875rem;color:#038c63;font-weight:600">
              <span>Discount</span>
              <span id="drawer-discount">- ₹0</span>
            </div>
            <div class="price-row" style="display:flex;justify-content:space-between;font-size:1rem;font-weight:800;color:#0f172a;margin-top:.25rem;padding-top:.5rem;border-top:1px solid #e2e8f0">
              <span>Total Amount</span>
              <span id="drawer-total">₹0</span>
            </div>
          </div>
          <a href="cart.html" class="btn btn-primary w-full" style="display:flex;align-items:center;justify-content:center;height:44px;background:#9f2089;color:#fff;border-radius:10px;font-weight:700;text-decoration:none">View Cart &amp; Checkout</a>
        </div>
      `;

      document.body.appendChild(overlay);
      document.body.appendChild(drawer);
    }
  },
  open() {
    this.ensureMarkup();
    document.getElementById('cart-drawer')?.classList.add('open');
    document.getElementById('cart-drawer-overlay')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    this.render();
  },
  close() {
    document.getElementById('cart-drawer')?.classList.remove('open');
    document.getElementById('cart-drawer-overlay')?.classList.remove('open');
    document.body.style.overflow = '';
  },
  toggle() {
    this.ensureMarkup();
    const el = document.getElementById('cart-drawer');
    if (el?.classList.contains('open')) this.close();
    else this.open();
  },
  render() {
    const items = window.Cart.getItems();
    const { totalItems, totalPrice, totalMrp } = window.Cart.getTotals();
    const totalDiscount = totalMrp - totalPrice;
    const discPct = totalMrp > 0 ? Math.round((totalDiscount / totalMrp) * 100) : 0;

    const countEl = document.getElementById('drawer-item-count');
    if (countEl) countEl.textContent = `${totalItems} ${totalItems === 1 ? 'Item' : 'Items'}`;

    const listEl = document.getElementById('drawer-items-list');
    if (!listEl) return;

    if (items.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="height:100%">
          <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg></div>
          <h3 style="font-size:1rem;font-weight:700;color:#1e293b">Your cart is empty</h3>
          <p style="font-size:.75rem;color:var(--muted-foreground);margin-top:.5rem;max-width:15rem;line-height:1.5">Add quality products from Meesho to start shopping!</p>
          <button onclick="CartDrawer.close()" class="btn btn-primary btn-sm" style="margin-top:1.5rem">Continue Shopping</button>
        </div>`;
      const footer = document.getElementById('drawer-footer');
      if (footer) footer.style.display = 'none';
      return;
    }

    const footer = document.getElementById('drawer-footer');
    if (footer) footer.style.display = '';

    listEl.innerHTML = items.map((item) => {
      const itemDiscount = item.mrp - item.price;
      const pct = item.mrp > 0 ? Math.round((itemDiscount / item.mrp) * 100) : 0;
      return `<div class="cart-drawer-item">
        <a href="product.html?id=${item.id}" onclick="CartDrawer.close()" style="flex-shrink:0;width:5rem;height:5rem;background:var(--muted);border-radius:.5rem;overflow:hidden;display:block;border:1px solid #f1f5f9">
          <img src="${item.image}" alt="${item.title}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'"/>
        </a>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem">
            <a href="product.html?id=${item.id}" onclick="CartDrawer.close()" style="flex:1;min-width:0">
              <h4 style="font-size:.875rem;font-weight:600;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.title}</h4>
            </a>
            <button onclick="Cart.removeItem(${item.id},'${item.size}');CartDrawer.render()" style="color:var(--muted-foreground);padding:2px;cursor:pointer;flex-shrink:0" aria-label="Remove">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
          <p style="font-size:.6875rem;color:var(--muted-foreground);margin-top:.25rem">Size: <b style="color:#475569">${item.size}</b>${item.seller ? ` • Seller: <b style="color:#475569">${item.seller}</b>` : ''}</p>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.5rem">
            <div style="display:flex;align-items:baseline;gap:.375rem;flex-wrap:wrap">
              <span style="font-size:1rem;font-weight:700;color:#1e293b">₹${item.price}</span>
              ${item.mrp > item.price ? `<span style="font-size:.75rem;color:#94a3b8;text-decoration:line-through">₹${item.mrp}</span><span style="font-size:.6875rem;color:#038c63;font-weight:700">${pct}% off</span>` : ''}
            </div>
            <div class="qty-ctrl">
              <button onclick="Cart.updateQuantity(${item.id},'${item.size}',${item.quantity - 1});CartDrawer.render()">−</button>
              <span>${item.quantity}</span>
              <button onclick="Cart.updateQuantity(${item.id},'${item.size}',${item.quantity + 1});CartDrawer.render()">+</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    const drawerMrpEl = document.getElementById('drawer-mrp');
    const drawerDiscEl = document.getElementById('drawer-discount');
    const drawerTotalEl = document.getElementById('drawer-total');
    if (drawerMrpEl) drawerMrpEl.textContent = `₹${totalMrp}`;
    if (drawerDiscEl) { drawerDiscEl.textContent = `- ₹${totalDiscount} (${discPct}% off)`; drawerDiscEl.closest('.price-row').style.display = totalDiscount > 0 ? 'flex' : 'none'; }
    if (drawerTotalEl) drawerTotalEl.textContent = `₹${totalPrice}`;
  },
};

/* ─────────────────────────────────────────────
   PAYMENT VERIFY OVERLAY (cosmetic timer, mock checkout)
   ───────────────────────────────────────────── */
window.PaymentVerify = {
  interval: null,
  start(onDone) {
    let s = 3;
    const el = document.getElementById('verify-overlay');
    const secEl = document.getElementById('verify-seconds');
    if (el) el.classList.add('open');
    if (secEl) secEl.textContent = s;
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      s--;
      if (secEl) secEl.textContent = s;
      if (s <= 0) { clearInterval(this.interval); if (el) el.classList.remove('open'); onDone && onDone(); }
    }, 1000);
  },
};

/* ─────────────────────────────────────────────
   SEARCH BOX (autocomplete + category suggestions)
   Reusable across pages: each page attaches its own input/dropdown
   elements and can override what happens on selection/submit. Pages with
   a live product grid (index.html) override onQueryChange to filter
   in place instead of navigating away.
   ───────────────────────────────────────────── */
window.SearchBox = {
  attach(inputEl, suggestionsEl, opts = {}) {
    const onQueryChange = opts.onQueryChange || (() => {});
    const onSelectCategory = opts.onSelectCategory || ((category) => {
      window.location.href = `index.html?category=${encodeURIComponent(category)}`;
    });
    const onSelectProduct = opts.onSelectProduct || ((product) => {
      try { sessionStorage.setItem('selected_product_id', String(product.id)); } catch (e) { /* ignore */ }
      window.location.href = `product.html?id=${product.id}`;
    });
    const onSubmit = opts.onSubmit || ((query) => {
      window.location.href = `index.html?search=${encodeURIComponent(query)}`;
    });

    let allProducts = [];
    let allCategories = [];
    let activeIndex = -1;

    window.ProductsReady.then((products) => {
      allProducts = products;
      allCategories = [...new Set(products.map((p) => p.category))];
    });

    function escapeHtml(s) {
      return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function highlight(text, q) {
      const idx = text.toLowerCase().indexOf(q.toLowerCase());
      if (idx === -1) return escapeHtml(text);
      return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(text.slice(idx + q.length));
    }

    function close() {
      suggestionsEl.style.display = 'none';
      suggestionsEl.innerHTML = '';
      activeIndex = -1;
    }

    function render(rawQ) {
      const q = rawQ.trim();
      if (!q) { close(); return; }

      const matchedCategories = allCategories.filter((c) => c.toLowerCase().includes(q.toLowerCase())).slice(0, 3);
      const matchedProducts = allProducts.filter((p) => p.title.toLowerCase().includes(q.toLowerCase())).slice(0, 6);

      if (matchedCategories.length === 0 && matchedProducts.length === 0) {
        suggestionsEl.innerHTML = `<div class="sg-empty">No results for "${escapeHtml(q)}"</div>`;
        suggestionsEl.style.display = '';
        activeIndex = -1;
        return;
      }

      let html = '';
      if (matchedCategories.length) {
        html += `<div class="sg-section-label">Categories</div>`;
        html += matchedCategories.map((c) => `
          <div class="sg-category-row" data-cat="${escapeHtml(c)}" role="button" tabindex="-1">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <span class="sg-title">${highlight(c, q)}</span>
          </div>`).join('');
      }
      if (matchedProducts.length) {
        html += `<div class="sg-section-label">Products</div>`;
        html += matchedProducts.map((p) => `
          <div class="sg-product-row" data-pid="${p.id}" role="button" tabindex="-1">
            <img src="${p.image}" alt="" onerror="this.style.visibility='hidden'">
            <span class="sg-title">${highlight(p.title, q)}</span>
            <span class="sg-price">₹${p.price}</span>
          </div>`).join('');
      }

      suggestionsEl.innerHTML = html;
      suggestionsEl.style.display = '';
      activeIndex = -1;

      suggestionsEl.querySelectorAll('[data-cat]').forEach((el) => {
        el.addEventListener('click', () => { onSelectCategory(el.dataset.cat); close(); });
      });
      suggestionsEl.querySelectorAll('[data-pid]').forEach((el) => {
        el.addEventListener('click', () => {
          const product = allProducts.find((p) => p.id === Number(el.dataset.pid));
          if (product) onSelectProduct(product);
          close();
        });
      });
    }

    inputEl.addEventListener('input', function () {
      onQueryChange(this.value.trim());
      render(this.value);
    });

    inputEl.addEventListener('focus', function () {
      if (this.value.trim()) render(this.value);
    });

    inputEl.addEventListener('keydown', function (e) {
      const rows = [...suggestionsEl.querySelectorAll('[data-cat],[data-pid]')];

      if (suggestionsEl.style.display === 'none' || rows.length === 0) {
        if (e.key === 'Enter' && this.value.trim()) onSubmit(this.value.trim());
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        rows.forEach((r) => r.classList.remove('active'));
        activeIndex += e.key === 'ArrowDown' ? 1 : -1;
        if (activeIndex >= rows.length) activeIndex = 0;
        if (activeIndex < 0) activeIndex = rows.length - 1;
        rows[activeIndex].classList.add('active');
        rows[activeIndex].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = activeIndex >= 0 ? rows[activeIndex] : null;
        if (target) target.click();
        else if (this.value.trim()) onSubmit(this.value.trim());
      } else if (e.key === 'Escape') {
        close();
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest || (!e.target.closest('.search-suggestions') && e.target !== inputEl)) close();
    });

    return { close, render };
  },
};

/* ─────────────────────────────────────────────
   UTILS
   ───────────────────────────────────────────── */
window.$ = (sel) => document.querySelector(sel);
window.$$ = (sel) => document.querySelectorAll(sel);

function navigate(url) { window.location.href = url; }

function renderStars(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  let s = '';
  for (let i = 0; i < full; i++) s += '★';
  if (half) s += '½';
  return s;
}

function formatINR(n) { return '₹' + Number(n).toLocaleString('en-IN'); }

/* ─────────────────────────────────────────────
   INIT on DOM Ready
   ───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  Promise.all([window.Cart.ready, window.Wishlist.ready]).then(updateAllBadges);
  window.Cart.onChange(() => updateAllBadges());
  window.Wishlist.onChange(() => updateAllBadges());
});
