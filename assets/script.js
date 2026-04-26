/* === Open Skill Diary — Frontend ===========================
 * Theme toggle, post list rendering, pagination, Pagefind search
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

  // ---------- Posts ----------
  const listEl = document.getElementById('posts-list');
  const pagerEl = document.getElementById('posts-pager');
  const searchInput = document.getElementById('osd-search-input');
  if (!listEl) return;

  const PER_PAGE = 6;
  let postsData = null;
  let view = [];
  let page = 1;

  function iconFor(category) {
    const map = { msa: 'MSA', kafka: 'KFK', websocket: 'WS', sse: 'SSE', default: '◆' };
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
  function cardHtml(p, i) {
    const tags = (p.tags || []).slice(0, 4).map(function(t){ return '<span class="post-card__tag">#' + t + '</span>'; }).join('');
    const date = new Date(p.date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
    return ''
      + '<li>'
      +   '<a class="post-card" href="' + p.filename + '">'
      +     '<div class="post-card__thumb" style="background: ' + gradientFor(i) + ';">'
      +       '<span class="post-card__thumb-icon">' + iconFor(p.category) + '</span>'
      +     '</div>'
      +     '<div class="post-card__body">'
      +       '<div class="post-card__meta">'
      +         '<span class="post-card__category">' + p.category + '</span>'
      +         '<span>' + date + '</span>'
      +       '</div>'
      +       '<h3 class="post-card__title">' + p.title + '</h3>'
      +       '<p class="post-card__summary">' + (p.summary || '') + '</p>'
      +       '<div class="post-card__tags">' + tags + '</div>'
      +     '</div>'
      +   '</a>'
      + '</li>';
  }
  function renderList() {
    const start = (page - 1) * PER_PAGE;
    const slice = view.slice(start, start + PER_PAGE);
    listEl.innerHTML = slice.length
      ? slice.map(function(p, i){ return cardHtml(p, start + i); }).join('')
      : '<li style="color: var(--text-muted); padding: 24px;">검색 결과 없음</li>';
    renderPager();
  }
  function renderPager() {
    if (!pagerEl) return;
    const total = Math.max(1, Math.ceil(view.length / PER_PAGE));
    if (total <= 1) { pagerEl.innerHTML = ''; return; }
    let html = '<button data-page="' + (page-1) + '" ' + (page===1?'disabled':'') + '>‹</button>';
    for (let i = 1; i <= total; i++) {
      html += '<button data-page="' + i + '" class="' + (i===page?'is-active':'') + '">' + i + '</button>';
    }
    html += '<button data-page="' + (page+1) + '" ' + (page===total?'disabled':'') + '>›</button>';
    pagerEl.innerHTML = html;
  }

  if (pagerEl) {
    pagerEl.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-page]');
      if (!btn || btn.disabled) return;
      const next = parseInt(btn.getAttribute('data-page'), 10);
      if (Number.isFinite(next) && next >= 1) {
        page = next;
        renderList();
        const target = document.getElementById('posts');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // ---------- Search (Pagefind JS API → cards 필터) ----------
  let searchTimer = null;
  function runSearch(q) {
    if (!postsData) return;
    const s = (q || '').trim();
    if (!s) {
      view = postsData.posts;
      page = 1;
      renderList();
      return;
    }
    const ql = s.toLowerCase();
    view = postsData.posts.filter(function(p) {
      return (p.title    || '').toLowerCase().indexOf(ql) >= 0
          || (p.summary  || '').toLowerCase().indexOf(ql) >= 0
          || (p.category || '').toLowerCase().indexOf(ql) >= 0
          || (p.tags || []).some(function(t){ return (t || '').toLowerCase().indexOf(ql) >= 0; });
    });
    page = 1;
    renderList();
  }
  if (searchInput) {
    searchInput.addEventListener('input', function (e) {
      clearTimeout(searchTimer);
      const q = e.target.value || '';
      searchTimer = setTimeout(function(){ runSearch(q); }, 150);
    });
  }

  // ---------- Bootstrap ----------
  fetch('posts.json', { cache: 'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      postsData = data;
      view = data.posts;
      renderList();
    })
    .catch(function(err){
      listEl.innerHTML = '<li style="color: var(--text-muted); padding: 24px;">포스트를 불러오지 못했습니다: ' + err.message + '</li>';
    });
})();
