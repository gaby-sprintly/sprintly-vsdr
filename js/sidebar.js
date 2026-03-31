// ── Shared Sidebar Component ──
// Renders sidebar HTML and initializes mobile toggle + theme toggle

function renderSidebar(activePage) {
  const navItems = [
    { href: 'index.html', page: 'home', label: 'Home', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>' },
    { href: 'bmc.html', page: 'strategy', label: 'Strategy', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>' },
    { href: 'goals.html', page: 'goals', label: 'Goals', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>' },
    { href: 'pipeline.html', page: 'pipeline', label: 'Pipeline', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' },
    {
      group: true, page: 'proposals', label: 'Proposals',
      href: 'proposals.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
      children: [
        { href: 'proposals.html', page: 'proposals', label: 'Proposal Lab', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:16px;height:16px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' }
      ]
    },
    {
      group: true, page: 'network', label: 'Network',
      href: 'network.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      children: [
        { href: 'matches.html', page: 'matches', label: 'Matches', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:16px;height:16px"><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/><circle cx="9" cy="11" r="3"/></svg>' },
        { href: 'interactions.html', page: 'interactions', label: 'Interactions', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:16px;height:16px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' }
      ]
    },
    { href: 'outreach.html', page: 'outreach', label: 'Outreach', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' },
    { href: 'analytics.html', page: 'analytics', label: 'Analytics', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>' },
    { href: 'reports.html', page: 'reports', label: 'Reports', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' },
    { href: 'ingestion.html', page: 'ingestion', label: 'Ingestion', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>' },
    { href: 'settings.html', page: 'settings', label: 'Settings', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' }
  ];

  let navHtml = '';
  navItems.forEach(item => {
    if (item.group) {
      const isActive = activePage === item.page || (item.children && item.children.some(c => c.page === activePage));
      navHtml += '<div class="nav-group">';
      navHtml += '<a href="' + item.href + '" class="nav-item' + (isActive ? ' active' : '') + '">' + item.icon + ' ' + item.label + '</a>';
      if (item.children) {
        item.children.forEach(child => {
          navHtml += '<a href="' + child.href + '" class="nav-sub' + (activePage === child.page ? ' active' : '') + '">' + child.icon + ' ' + child.label + '</a>';
        });
      }
      navHtml += '</div>';
    } else {
      navHtml += '<a href="' + item.href + '" class="nav-item' + (activePage === item.page ? ' active' : '') + '">' + item.icon + ' ' + item.label + '</a>';
    }
  });

  return '<button class="hamburger" id="hamburger" aria-label="Open menu">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
  '</button>' +
  '<div class="sidebar-backdrop" id="backdrop"></div>' +
  '<aside class="sidebar" id="sidebar">' +
    '<button class="sidebar-close" id="sidebarClose" aria-label="Close menu">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
    '</button>' +
    '<div class="sidebar-brand"><div class="sidebar-logo">VSDR <span class="pulse-dot"></span></div></div>' +
    '<div class="sidebar-sub">Sprintly Partners</div>' +
    '<nav class="sidebar-nav">' + navHtml + '</nav>' +
    '<div class="theme-toggle" style="padding:0 24px;margin-bottom:12px;">' +
      '<button id="themeToggle" class="theme-btn"><span class="theme-icon">☀️</span><span class="theme-label">Light Mode</span></button>' +
    '</div>' +
    '<div style="padding:0 24px;margin-bottom:8px;">' +
      '<button id="logoutBtn" class="theme-btn" style="color:#EF4444;border-color:rgba(239,68,68,0.2);" onclick="authSignOut()"><span style="font-size:14px">↪</span><span>Sign Out</span></button>' +
    '</div>' +
    '<div class="sidebar-version">v2.2</div>' +
  '</aside>';
}

function initSidebar(activePage) {
  // Auth guard — redirect to login if not authenticated
  if (typeof requireAuth === 'function') {
    requireAuth();
  }

  // Insert sidebar HTML at start of body
  const container = document.createElement('div');
  container.innerHTML = renderSidebar(activePage);
  while (container.firstChild) {
    document.body.insertBefore(container.firstChild, document.body.firstChild);
  }

  // Mobile toggle
  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('backdrop');
  const sidebarClose = document.getElementById('sidebarClose');

  function openSidebar() { sidebar.classList.add('open'); backdrop.classList.add('open'); }
  function closeSidebar() { sidebar.classList.remove('open'); backdrop.classList.remove('open'); }

  if (hamburger) hamburger.addEventListener('click', openSidebar);
  if (sidebarClose) sidebarClose.addEventListener('click', closeSidebar);
  if (backdrop) backdrop.addEventListener('click', closeSidebar);

  // Theme toggle + offline detection
  initTheme();
  initOfflineDetection();
}

function initTheme() {
  // I11: Default to system preference if no saved theme
  var saved = localStorage.getItem('vsdr-theme');
  if (!saved) {
    saved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeBtn(saved);
  var btn = document.getElementById('themeToggle');
  if (btn) btn.addEventListener('click', function() {
    var cur = document.documentElement.getAttribute('data-theme') || 'dark';
    var next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('vsdr-theme', next);
    updateThemeBtn(next);
  });
  // I10: Sync theme across tabs
  window.addEventListener('storage', function(e) {
    if (e.key === 'vsdr-theme' && e.newValue) {
      document.documentElement.setAttribute('data-theme', e.newValue);
      updateThemeBtn(e.newValue);
    }
  });
  // I11: React to system theme changes (if user hasn't manually set)
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function(e) {
      if (!localStorage.getItem('vsdr-theme')) {
        var theme = e.matches ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        updateThemeBtn(theme);
      }
    });
  }
}

// I3: Offline detection — shows indicator on all pages
function initOfflineDetection() {
  var indicator = document.createElement('div');
  indicator.id = 'offlineBar';
  indicator.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;z-index:9999;background:#F59E0B;color:#0F1923;text-align:center;padding:6px 16px;font-size:12px;font-weight:600;font-family:var(--body,sans-serif);';
  indicator.textContent = 'You are offline — changes will be saved when you reconnect';
  document.body.appendChild(indicator);

  function update() {
    indicator.style.display = navigator.onLine ? 'none' : 'block';
  }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function updateThemeBtn(theme) {
  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.querySelector('.theme-icon').textContent = theme === 'light' ? '🌙' : '☀️';
  btn.querySelector('.theme-label').textContent = theme === 'light' ? 'Dark Mode' : 'Light Mode';
}
