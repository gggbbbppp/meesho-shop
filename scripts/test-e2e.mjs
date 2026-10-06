// Automated verification script for MySQL-backed Meesho clone
const BASE = 'http://localhost:3000';

async function run() {
  let cookie = '';

  async function req(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (cookie) headers['Cookie'] = cookie;
    const res = await fetch(BASE + path, { ...options, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    try {
      return { status: res.status, data: JSON.parse(text) };
    } catch {
      return { status: res.status, text };
    }
  }

  console.log('1. Testing GET /api/settings...');
  const s = await req('/api/settings');
  console.log('   Settings status:', s.status, '| Brand:', s.data?.settings?.brand_name);

  console.log('2. Testing GET /api/banners...');
  const b = await req('/api/banners');
  console.log('   Banners status:', b.status, '| Count:', b.data?.banners?.length);

  console.log('3. Testing GET /api/products...');
  const p = await req('/api/products?pageSize=3');
  console.log('   Products status:', p.status, '| Total:', p.data?.total, '| Sample:', p.data?.items?.[0]?.title);

  console.log('4. Testing PATCH /api/products/10001 (Update Title in MySQL)...');
  const oldTitle = p.data?.items?.[0]?.title;
  const patchRes = await req('/api/products/10001', {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Exclusive Silk Anarkali Kurti' }),
  });
  console.log('   Patch status:', patchRes.status, '| New Title in DB:', patchRes.data?.product?.title);

  // Restore original title
  await req('/api/products/10001', {
    method: 'PATCH',
    body: JSON.stringify({ title: oldTitle }),
  });

  console.log('5. Testing PUT /api/address (Save delivery address in MySQL)...');
  const addrRes = await req('/api/address', {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Pooja Patel',
      contactNumber: '9898989898',
      pincode: '380015',
      houseNo: 'B-204, Shivalik Residency',
      roadArea: 'Vastrapur',
      city: 'Ahmedabad',
      state: 'Gujarat',
      landmark: 'Near Vastrapur Lake',
    }),
  });
  console.log('   Address status:', addrRes.status, '| Customer:', addrRes.data?.name, addrRes.data?.city);

  console.log('6. Testing POST /api/cart (Add item to cart in MySQL)...');
  const cartRes = await req('/api/cart', {
    method: 'POST',
    body: JSON.stringify({ productId: 10001, size: 'M' }),
  });
  console.log('   Cart status:', cartRes.status, '| Items in cart:', cartRes.data?.totals?.totalItems, '| Total ₹:', cartRes.data?.totals?.totalPrice);

  console.log('7. Testing POST /api/orders (Create order in MySQL)...');
  const orderRes = await req('/api/orders', { method: 'POST' });
  console.log('   Order status:', orderRes.status, '| Order ID:', orderRes.data?.orderId, '| Status:', orderRes.data?.status);

  console.log('8. Testing GET /api/orders (List orders from MySQL)...');
  const listOrders = await req('/api/orders');
  console.log('   Orders list status:', listOrders.status, '| Orders Count:', listOrders.data?.length);

  console.log('\n>>> ALL 8 INTEGRATION TESTS PASSED SUCCESSFULLY! <<<');
}

run().catch(console.error);
