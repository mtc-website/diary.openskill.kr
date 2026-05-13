/* === Open Skill Diary — Frontend ===========================
 * Theme toggle, post list rendering, category filter (always-on,
 * multi-category aware), search, pagination.
 * ============================================================ */
(function () {
  'use strict';

  // ---------- Theme toggle ----------
  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('blog-theme', t); } catch (e) {}
  }
  if (toggle) {
    toggle.addEventListener('click', function () {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }

  // ---------- DOM refs ----------
  const listEl = document.getElementById('posts-list');
  const pagerEl = document.getElementById('posts-pager');
  const searchInput = document.getElementById('osd-search-input');
  const filterEl = document.getElementById('posts-filter');
  const heroCatsEl = document.getElementById('hero-categories');
  if (!listEl) return;

  // ---------- State ----------
  const PER_PAGE = 6;
  let postsData = null;
  let view = [];
  let page = 1;
  let activeCategory = 'all';
  let query = '';

  // ---------- Helpers ----------
  function getCategoriesOf(p) {
    if (Array.isArray(p.categories)) return p.categories;
    if (p.category) return [p.category];
    return [];
  }
  function uniqInsertionOrder(items) {
    const seen = new Set();
    const out = [];
    for (const x of items) {
      if (!seen.has(x)) { seen.add(x); out.push(x); }
    }
    return out;
  }
  function collectCategories(data) {
    if (Array.isArray(data.categories) && data.categories.length) return data.categories;
    return uniqInsertionOrder(data.posts.flatMap(getCategoriesOf));
  }
  function iconFor(category) {
    const map = { msa: 'MSA', kafka: 'KFK', websocket: 'WS', sse: 'SSE', default: '◆' };
    if (!category) return map.default;
    return map[category.toLowerCase()] || category.slice(0, 3).toUpperCase();
  }
  function gradientFor(idx) {
    const palettes = [
      ['#3b82f6', '#8b5cf6'], ['#06b6d4', '#3b82f6'], ['#10b981', '#06b6d4'],
      ['#f59e0b', '#ef4444'], ['#ec4899', '#8b5cf6'], ['#6366f1', '#ec4899'],
      ['#14b8a6', '#22c55e'],
    ];
    const [a, b] = palettes[idx % palettes.length];
    return 'linear-gradient(135deg, ' + a + ' 0%, ' + b + ' 100%)';
  }

  // ---------- Rendering ----------
  function cardHtml(p, i) {
    const cats = getCategoriesOf(p);
    const primary = cats[0] || '';
    const tags = (p.tags || []).slice(0, 4)
      .map(function (t) { return '<span class="post-card__tag">#' + t + '</span>'; })
      .join('');
    const date = new Date(p.date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
    const catLabels = cats
      .map(function (c) { return '<span class="post-card__category">' + c + '</span>'; })
      .join(' ');
    return ''
      + '<li>'
      +   '<a class="post-card" href="' + p.filename + '">'
      +     '<div class="post-card__thumb" style="background: ' + gradientFor(i) + ';">'
      +       '<span class="post-card__thumb-icon">' + iconFor(primary) + '</span>'
      +     '</div>'
      +     '<div class="post-card__body">'
      +       '<div class="post-card__meta">'
      +         catLabels
      +         '<span>' + date + '</span>'
      +       '</div>'
      +       '<h3 class="post-card__title">' + p.title + '</h3>'
      +       '<p class="post-card__summary">' + (p.summary || '') + '</p>'
      +       '<div class="post-card__tags">' + tags + '</div>'
      +     '</div>'
      +   '</a>'
      + '</li>';
  }

  function renderFilterChips() {
    if (!postsData) return;
    const cats = collectCategories(postsData);
    if (heroCatsEl) {
      heroCatsEl.innerHTML = cats
        .map(function (c) {
          const cls = 'hero__category' + (c === activeCategory ? ' is-active' : '');
          return '<button class="' + cls + '" data-cat="' + c + '">' + c + '</button>';
        })
        .join('');
    }
    if (filterEl) {
      const all = [{ k: 'all', label: '전체' }].concat(cats.map(function (c) { return { k: c, label: c }; }));
      filterEl.innerHTML = all
        .map(function (o) {
          const cls = 'hero__category' + (o.k === activeCategory ? ' is-active' : '');
          return '<button class="' + cls + '" data-cat="' + o.k + '">' + o.label + '</button>';
        })
        .join('');
    }
  }

  function computeView() {
    if (!postsData) { view = []; return; }
    const ql = (query || '').trim().toLowerCase();
    view = postsData.posts.filter(function (p) {
      if (activeCategory !== 'all') {
        const cats = getCategoriesOf(p).map(function (c) { return (c || '').toLowerCase(); });
        if (!cats.includes(activeCategory.toLowerCase())) return false;
      }
      if (!ql) return true;
      const hayCats = getCategoriesOf(p).join(' ').toLowerCase();
      return (p.title    || '').toLowerCase().indexOf(ql) >= 0
          || (p.summary  || '').toLowerCase().indexOf(ql) >= 0
          || hayCats.indexOf(ql) >= 0
          || (p.tags || []).some(function (t) { return (t || '').toLowerCase().indexOf(ql) >= 0; });
    });
  }

  function renderList() {
    const start = (page - 1) * PER_PAGE;
    const slice = view.slice(start, start + PER_PAGE);
    listEl.innerHTML = slice.length
      ? slice.map(function (p, i) { return cardHtml(p, start + i); }).join('')
      : '<li style="color: var(--text-muted); padding: 24px;">표시할 글이 없습니다.</li>';
    renderPager();
  }

  function renderPager() {
    if (!pagerEl) return;
    const total = Math.max(1, Math.ceil(view.length / PER_PAGE));
    if (total <= 1) { pagerEl.innerHTML = ''; return; }
    let html = '<button data-page="' + (page - 1) + '" ' + (page === 1 ? 'disabled' : '') + '>‹</button>';
    for (let i = 1; i <= total; i++) {
      html += '<button data-page="' + i + '" class="' + (i === page ? 'is-active' : '') + '">' + i + '</button>';
    }
    html += '<button data-page="' + (page + 1) + '" ' + (page === total ? 'disabled' : '') + '>›</button>';
    pagerEl.innerHTML = html;
  }

  function refreshAll() {
    computeView();
    page = 1;
    renderFilterChips();
    renderList();
  }

  // ---------- Event wiring ----------
  document.body.addEventListener('click', function (e) {
    const catBtn = e.target.closest('[data-cat]');
    if (catBtn) {
      activeCategory = catBtn.getAttribute('data-cat');
      refreshAll();
      const target = document.getElementById('posts');
      if (target && catBtn.closest('.hero__categories')) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    if (pagerEl) {
      const pageBtn = e.target.closest('button[data-page]');
      if (pageBtn && !pageBtn.disabled) {
        const next = parseInt(pageBtn.getAttribute('data-page'), 10);
        if (Number.isFinite(next) && next >= 1) {
          page = next;
          renderList();
          const target = document.getElementById('posts');
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
  });

  if (searchInput) {
    let searchTimer = null;
    searchInput.addEventListener('input', function (e) {
      clearTimeout(searchTimer);
      query = e.target.value || '';
      searchTimer = setTimeout(function () {
        computeView();
        page = 1;
        renderList();
      }, 150);
    });
  }

  // ---------- Bootstrap ----------
  fetch('posts.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      postsData = data;
      refreshAll();
    })
    .catch(function (err) {
      listEl.innerHTML = '<li style="color: var(--text-muted); padding: 24px;">포스트를 불러오지 못했습니다: ' + err.message + '</li>';
    });
})();
