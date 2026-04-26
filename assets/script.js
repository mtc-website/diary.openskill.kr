/* === Open Skill Diary — Frontend ===========================
 * Theme toggle, post list rendering, category filter
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
  const filterEl = document.getElementById('posts-filter');
  const heroCatsEl = document.getElementById('hero-categories');

  if (!listEl) return;

  let activeCategory = 'all';
  let postsData = null;

  function iconFor(category) {
    const map = { msa: 'MSA', kafka: 'KFK', websocket: 'WS', sse: 'SSE', default: '◆' };
    return map[category.toLowerCase()] || category.slice(0, 3).toUpperCase();
  }

  function gradientFor(idx) {
    const palettes = [
      ['#3b82f6', '#8b5cf6'],
      ['#06b6d4', '#3b82f6'],
      ['#10b981', '#06b6d4'],
      ['#f59e0b', '#ef4444'],
      ['#ec4899', '#8b5cf6'],
      ['#6366f1', '#ec4899'],
      ['#14b8a6', '#22c55e'],
    ];
    const [a, b] = palettes[idx % palettes.length];
    return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
  }

  function render(data) {
    // Hero categories
    if (heroCatsEl) {
      heroCatsEl.innerHTML = data.categories
        .map(c => `<button class="hero__category" data-cat="${c}">${c}</button>`)
        .join('');
    }

    // Filter chips
    if (filterEl) {
      const cats = ['all', ...data.categories];
      filterEl.innerHTML = cats
        .map(c => `<button class="hero__category${c === activeCategory ? ' is-active' : ''}" data-cat="${c}">${c === 'all' ? '전체' : c}</button>`)
        .join('');
    }

    // Posts
    const filtered = activeCategory === 'all'
      ? data.posts
      : data.posts.filter(p => p.category.toLowerCase() === activeCategory.toLowerCase());

    listEl.innerHTML = filtered.map((p, i) => {
      const tags = (p.tags || []).slice(0, 4)
        .map(t => `<span class="post-card__tag">#${t}</span>`).join('');
      const date = new Date(p.date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
      return `
        <li>
          <a class="post-card" href="${p.filename}">
            <div class="post-card__thumb" style="background: ${gradientFor(i)};">
              <span class="post-card__thumb-icon">${iconFor(p.category)}</span>
            </div>
            <div class="post-card__body">
              <div class="post-card__meta">
                <span class="post-card__category">${p.category}</span>
                <span>${date}</span>
              </div>
              <h3 class="post-card__title">${p.title}</h3>
              <p class="post-card__summary">${p.summary}</p>
              <div class="post-card__tags">${tags}</div>
            </div>
          </a>
        </li>
      `;
    }).join('');
  }

  function attachFilterClicks() {
    document.body.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      activeCategory = btn.getAttribute('data-cat');
      render(postsData);
      const target = document.getElementById('posts');
      if (target && btn.closest('.hero__categories')) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  fetch('posts.json', { cache: 'no-store' })
    .then(r => r.json())
    .then(data => {
      postsData = data;
      render(data);
      attachFilterClicks();
    })
    .catch(err => {
      listEl.innerHTML = `<li style="color: var(--text-muted); padding: 24px;">포스트를 불러오지 못했습니다: ${err.message}</li>`;
    });
})();
