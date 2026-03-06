const PROXY = 'https://cors-anywhere.herokuapp.com/';
const CACHE_MS = 5 * 60 * 1000;
const FALLBACK_IMG = 'https://placehold.co/640x360/1b2430/ffffff?text=Roblox+Tracker';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';

const I18N = {
  en: {
    heroTitle: 'Automatic Roblox Game Tracking',
    heroSubtitle: 'Live data, beautiful stats, and active communities in one place.',
    requestGame: 'Request a Game',
    trackedGames: 'Tracked Games',
    communities: 'Communities',
    activePlayers: 'Active Players',
    totalVisits: 'Total Visits',
    games: 'Games',
    recentGames: 'Recently Added',
    sortPlayers: 'Sort by Players',
    sortVisits: 'Sort by Visits',
    sortFavorites: 'Sort by Favorites'
  },
  ru: {
    heroTitle: 'Автоматический трекинг Roblox-игр',
    heroSubtitle: 'Живые данные, красивая статистика и активные сообщества.',
    requestGame: 'Запросить игру',
    trackedGames: 'Отслеживаемых игр',
    communities: 'Сообщества',
    activePlayers: 'Активные игроки',
    totalVisits: 'Всего посещений',
    games: 'Игры',
    recentGames: 'Недавно добавленные',
    sortPlayers: 'Сортировка по игрокам',
    sortVisits: 'Сортировка по посещениям',
    sortFavorites: 'Сортировка по избранному'
  }
};

const parseJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); });
const formatNum = (n) => {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n || 0}`;
};
const formatDate = (v) => v ? new Date(v).toLocaleDateString() : '-';

function getCache(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (Date.now() - parsed.time > CACHE_MS) return null;
  return parsed.data;
}

function setCache(key, data) {
  localStorage.setItem(key, JSON.stringify({ time: Date.now(), data }));
}

async function cachedFetch(key, url) {
  const cached = getCache(key);
  if (cached) return cached;
  const data = await parseJSON(url);
  setCache(key, data);
  return data;
}

function setupThemeAndLang() {
  const theme = localStorage.getItem('theme') || 'dark';
  const lang = localStorage.getItem('lang') || 'en';
  if (theme === 'light') document.documentElement.classList.add('light');

  const themeToggle = document.querySelector('#themeToggle');
  if (themeToggle) {
    themeToggle.textContent = theme === 'light' ? '☀️' : '🌙';
    themeToggle.onclick = () => {
      document.documentElement.classList.toggle('light');
      const isLight = document.documentElement.classList.contains('light');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      themeToggle.textContent = isLight ? '☀️' : '🌙';
    };
  }

  const langToggle = document.querySelector('#langToggle');
  const applyLang = (l) => {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (I18N[l][key]) el.textContent = I18N[l][key];
    });
    if (langToggle) langToggle.textContent = l === 'en' ? 'RU' : 'EN';
    localStorage.setItem('lang', l);
  };
  applyLang(lang);
  if (langToggle) langToggle.onclick = () => applyLang((localStorage.getItem('lang') || 'en') === 'en' ? 'ru' : 'en');
}

async function loadLocalData() {
  const [games, communities] = await Promise.all([
    parseJSON('/tracking/data/games.json'),
    parseJSON('/tracking/data/communities.json')
  ]);
  return { games, communities };
}

function renderCard(game, details = {}) {
  const players = details.playing || 0;
  const visits = details.visits || 0;
  const favorites = details.favoritedCount || 0;
  const img = details.thumbnail || FALLBACK_IMG;
  return `<article class="card">
      <img src="${img}" alt="${game.displayName}" onerror="this.src='${FALLBACK_IMG}'" />
      <div class="card-body">
        <h3>${game.displayName}</h3>
        <p>${game.owner}</p>
        <p>👥 ${formatNum(players)} | 👁️ ${formatNum(visits)} | ⭐ ${formatNum(favorites)}</p>
        <a class="btn ghost" href="/tracking/games/template.html?id=${game.id}">View</a>
      </div>
    </article>`;
}

async function enrichGames(games) {
  const universeIds = games.map((g) => g.universeId).join(',');
  const gameData = await cachedFetch(`games_api_${universeIds}`, `${PROXY}https://games.roblox.com/v1/games?universeIds=${universeIds}`);
  const thumbs = await cachedFetch(`thumb_api_${universeIds}`, `${PROXY}https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeIds}&size=512x512&format=Png&isCircular=false`);
  const thumbMap = Object.fromEntries((thumbs.data || []).map((t) => [String(t.targetId), t.imageUrl]));
  return games.map((g) => {
    const api = (gameData.data || []).find((x) => String(x.id) === String(g.universeId)) || {};
    return { ...g, details: { ...api, thumbnail: thumbMap[g.universeId] || FALLBACK_IMG } };
  });
}

function renderSpinner(el) { el.innerHTML = '<div class="spinner"></div>'; }

async function initHome() {
  const gamesGrid = document.querySelector('#gamesGrid');
  if (!gamesGrid) return;
  const communitiesGrid = document.querySelector('#communitiesGrid');
  const recentGames = document.querySelector('#recentGames');
  renderSpinner(gamesGrid);

  try {
    const { games, communities } = await loadLocalData();
    let enriched = await enrichGames(games);
    const sortSelect = document.querySelector('#sortGames');

    const paint = (sortBy = 'players') => {
      enriched = [...enriched].sort((a, b) => (b.details[sortBy === 'players' ? 'playing' : sortBy === 'visits' ? 'visits' : 'favoritedCount'] || 0) - (a.details[sortBy === 'players' ? 'playing' : sortBy === 'visits' ? 'visits' : 'favoritedCount'] || 0));
      gamesGrid.innerHTML = enriched.map((g) => renderCard(g, g.details)).join('');
    };

    paint('players');
    sortSelect.onchange = () => paint(sortSelect.value);

    recentGames.innerHTML = [...enriched]
      .sort((a, b) => new Date(b.added) - new Date(a.added))
      .slice(0, 4)
      .map((g) => renderCard(g, g.details)).join('');

    communitiesGrid.innerHTML = communities.map((c) => `<article class="card"><div class="card-body"><h3>${c.name}</h3><p>${c.tagline || ''}</p><a class="btn ghost" href="/tracking/communities/template.html?id=${c.id}">Open</a></div></article>`).join('');

    document.querySelector('#trackedGames').textContent = games.length;
    document.querySelector('#trackedCommunities').textContent = communities.length;
    document.querySelector('#activePlayers').textContent = formatNum(enriched.reduce((acc, g) => acc + (g.details.playing || 0), 0));
    document.querySelector('#totalVisits').textContent = formatNum(enriched.reduce((acc, g) => acc + (g.details.visits || 0), 0));
  } catch (e) {
    gamesGrid.innerHTML = '<p>Unable to load games data right now.</p>';
  }
}

function resolveIdFromPath(type) {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const idx = parts.indexOf(type);
  if (idx !== -1 && parts[idx + 1] && parts[idx + 1] !== 'template.html') return parts[idx + 1];
  return new URLSearchParams(window.location.search).get('id');
}

async function initGamePage() {
  const titleEl = document.querySelector('#gameTitle');
  if (!titleEl) return;
  const gameId = resolveIdFromPath('games');
  if (!gameId) return titleEl.textContent = 'Game ID not found';

  const { games } = await loadLocalData();
  const game = games.find((g) => String(g.id) === String(gameId));
  if (!game) return titleEl.textContent = 'Game not found';

  try {
    const detailed = (await enrichGames([game]))[0];
    const details = detailed.details;
    titleEl.textContent = detailed.displayName;
    document.querySelector('#gameDescription').textContent = details.description || 'No description provided.';
    document.querySelector('#gameOwner').textContent = detailed.owner;
    document.querySelector('#gameGenre').textContent = details.genre || '-';
    document.querySelector('#gameSubgenre').textContent = details.genre_l1 || '-';
    document.querySelector('#createdDate').textContent = formatDate(details.created);
    document.querySelector('#updatedDate').textContent = formatDate(details.updated);

    document.querySelector('#gameStats').innerHTML = [
      ['Active Players', formatNum(details.playing || 0)],
      ['Favorites', formatNum(details.favoritedCount || 0)],
      ['Visits', formatNum(details.visits || 0)],
      ['Server Size', details.maxPlayers || '-']
    ].map(([k, v]) => `<article class="stat-card glass"><span>${k}</span><strong>${v}</strong></article>`).join('');

    document.querySelector('#playNow').href = `https://www.roblox.com/games/${game.id}`;

    const sliderWrap = document.querySelector('#slider');
    const shots = await cachedFetch(`shots_${game.universeId}`, `${PROXY}https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${game.universeId}&countPerUniverse=6&defaults=true&size=768x432&format=Png&isCircular=false`);
    const images = ((shots.data && shots.data[0] && shots.data[0].thumbnails) || []).map((s) => s.imageUrl).filter(Boolean);
    const slides = (images.length ? images : [details.thumbnail || FALLBACK_IMG]).map((src, i) => `<div class="slide ${i === 0 ? 'active' : ''}"><img src="${src}" onerror="this.src='${FALLBACK_IMG}'" /></div>`).join('');
    sliderWrap.innerHTML = slides;

    let idx = 0;
    const slideEls = [...sliderWrap.querySelectorAll('.slide')];
    setInterval(() => {
      if (slideEls.length < 2) return;
      slideEls[idx].classList.remove('active');
      idx = (idx + 1) % slideEls.length;
      slideEls[idx].classList.add('active');
    }, 3500);

    const ctx = document.querySelector('#activityChart');
    if (ctx && window.Chart) {
      const base = Math.max(details.playing || 100, 25);
      const points = [...Array(24)].map((_, i) => ({ x: `${i}:00`, y: Math.max(1, Math.floor(base * (0.75 + Math.random() * 0.6))) }));
      new Chart(ctx, {
        type: 'line',
        data: { labels: points.map((p) => p.x), datasets: [{ label: 'Players', data: points.map((p) => p.y), borderColor: '#00A2FF', backgroundColor: 'rgba(0,162,255,.2)', fill: true, tension: .35 }] },
        options: { plugins: { legend: { labels: { color: '#9fb0bf' } } }, scales: { y: { ticks: { color: '#9fb0bf' } }, x: { ticks: { color: '#9fb0bf' } } } }
      });
    }
  } catch {
    titleEl.textContent = 'Unable to load game details now.';
  }
}

async function initCommunityPage() {
  const nameEl = document.querySelector('#communityName');
  if (!nameEl) return;
  const id = resolveIdFromPath('communities');
  if (!id) return nameEl.textContent = 'Community ID not found';

  try {
    const { communities, games } = await loadLocalData();
    const localCommunity = communities.find((c) => String(c.id) === String(id));
    const group = await cachedFetch(`group_${id}`, `${PROXY}https://groups.roblox.com/v1/groups/${id}`);

    nameEl.textContent = group.name || localCommunity?.name || 'Unknown Group';
    document.querySelector('#communityDesc').textContent = group.description || localCommunity?.tagline || '';
    document.querySelector('#communityMembers').textContent = formatNum(group.memberCount || 0);
    document.querySelector('#communityLink').href = `https://www.roblox.com/communities/${id}`;

    const communityGames = games.filter((g) => String(g.ownerId) === String(id));
    const grid = document.querySelector('#communityGames');
    if (!communityGames.length) {
      grid.innerHTML = '<p class="muted">No games connected yet.</p>';
      return;
    }
    const enriched = await enrichGames(communityGames);
    grid.innerHTML = enriched.map((g) => renderCard(g, g.details)).join('');
  } catch {
    nameEl.textContent = 'Unable to load community details now.';
  }
}

function initRequestForm() {
  const form = document.querySelector('#requestForm');
  if (!form) return;
  const status = document.querySelector('#formStatus');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'form-status';
    status.textContent = 'Submitting...';
    status.classList.remove('hidden');

    const payload = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed');
      status.textContent = '🎉 Success! Request sent. We will review your game soon.';
      status.classList.add('ok');
      form.reset();
    } catch {
      status.textContent = 'Could not send right now. Please try again later.';
      status.classList.add('err');
    }
  });
}

setupThemeAndLang();
initHome();
initGamePage();
initCommunityPage();
initRequestForm();
