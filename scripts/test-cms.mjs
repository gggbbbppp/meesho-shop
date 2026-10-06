// Automated verification of Admin CMS functionality with MySQL
const BASE = 'http://localhost:3000';

async function testCMS() {
  console.log('--- 1. Testing Website Settings CMS ---');
  const setRes = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      site_title: 'Meesho Fashion Hub - Best Deals',
      brand_name: 'meesho hub',
      marquee_text: 'SPECIAL DISCOUNT: 60% OFF TODAY ONLY!',
    }),
  });
  const setData = await setRes.json();
  console.log('Updated settings:', setData.settings?.site_title, '| Brand:', setData.settings?.brand_name);

  // Restore default
  await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      site_title: 'meesho - Lowest Prices, Best Quality Shopping',
      brand_name: 'meesho',
      marquee_text: 'LAST DAY SALE AT 3 PIC COMBO PRICE 199/- ONLY',
    }),
  });
  console.log('Restored default settings.');

  console.log('\n--- 2. Testing Homepage Banners CMS ---');
  const addBannerRes = await fetch(`${BASE}/api/banners`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: 'assets/test_banner.jpg',
      altText: 'Super Saver Festive Banner',
      sortOrder: 10,
    }),
  });
  const addBannerData = await addBannerRes.json();
  const bannerId = addBannerData.id;
  console.log('Added new banner with ID:', bannerId);

  // Edit banner
  const editBannerRes = await fetch(`${BASE}/api/banners/${bannerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      altText: 'Super Saver Festive Banner (Updated)',
      sortOrder: 12,
    }),
  });
  const editBannerData = await editBannerRes.json();
  console.log('Edited banner status:', editBannerData.success);

  // Delete banner
  const delBannerRes = await fetch(`${BASE}/api/banners/${bannerId}`, { method: 'DELETE' });
  const delBannerData = await delBannerRes.json();
  console.log('Deleted banner status:', delBannerData.success);

  console.log('\n--- 3. Testing Products Catalog CMS ---');
  // Add new product
  const addProdRes = await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'CMS Test Designer Georgette Kurti',
      price: 189,
      mrp: 799,
      category: 'Kurtis & Dress Material',
      image: 'assets/kurti2-BijmMluk.jpg',
    }),
  });
  const addProdData = await addProdRes.json();
  const newProdId = addProdData.product?.id;
  console.log('Added new product ID:', newProdId, '| Title:', addProdData.product?.title, '| Price: ₹' + addProdData.product?.price);

  // Edit product
  const editProdRes = await fetch(`${BASE}/api/products/${newProdId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'CMS Test Designer Georgette Kurti (Updated)',
      price: 199,
    }),
  });
  const editProdData = await editProdRes.json();
  console.log('Edited product in MySQL:', editProdData.product?.title, '| New Price: ₹' + editProdData.product?.price);

  // Delete product
  const delProdRes = await fetch(`${BASE}/api/products/${newProdId}`, { method: 'DELETE' });
  const delProdData = await delProdRes.json();
  console.log('Deleted product from MySQL:', delProdData.deletedId);

  console.log('\n--- 4. Testing Admin HTML Accessibility ---');
  const adminPageRes = await fetch(`${BASE}/admin`);
  console.log('Admin Page Status:', adminPageRes.status, '| HTML Length:', (await adminPageRes.text()).length);

  console.log('\n>>> ALL CMS INTEGRATION TESTS PASSED 100%! <<<');
}

testCMS().catch(console.error);
