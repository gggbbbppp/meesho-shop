// Loads dynamic site settings (title, brand name, marquee) and banners from MySQL
(function() {
  async function loadSiteSettings() {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.settings) return;

      window.SITE_SETTINGS = data.settings;
      const { site_title, brand_name, marquee_text, meta_description, search_placeholder } = data.settings;

      // 1. Update Document Title
      if (site_title) {
        document.title = site_title;
      }

      // 2. Update Meta Description
      if (meta_description) {
        let meta = document.querySelector('meta[name="description"]');
        if (meta) meta.setAttribute('content', meta_description);
      }

      // 3. Update Brand Logo Text
      if (brand_name) {
        const brandEls = document.querySelectorAll('.site-brand-logo, header a[href="index.html"].font-bold');
        brandEls.forEach(el => {
          el.textContent = brand_name;
        });
      }

      // 4. Update Marquee Announcement Bar
      if (marquee_text) {
        const marqueeInners = document.querySelectorAll('.top-marquee-bar .marquee__inner');
        marqueeInners.forEach(inner => {
          inner.innerHTML = '';
          for (let i = 0; i < 5; i++) {
            const span = document.createElement('span');
            span.textContent = marquee_text;
            inner.appendChild(span);
            if (i < 4) inner.appendChild(document.createTextNode('\u00A0 '));
          }
        });
      }

      // 5. Update Search Input Placeholder
      if (search_placeholder) {
        const searchInputs = document.querySelectorAll('#search-input, input[placeholder*="Search"]');
        searchInputs.forEach(input => {
          // Do not overwrite admin specific search boxes like order search
          if (!input.classList.contains('search-input-box') && input.id !== 'order-search-box' && input.id !== 'prod-search-input') {
            input.setAttribute('placeholder', search_placeholder);
          }
        });
      }
    } catch (err) {
      console.warn('Could not load dynamic settings from MySQL:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSiteSettings);
  } else {
    loadSiteSettings();
  }
})();
