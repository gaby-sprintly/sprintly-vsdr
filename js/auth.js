// ── VSDR Auth Module ──
// Uses Supabase Auth REST API (no SDK needed)
// Checks session on every page load, redirects to login if not authenticated.
// Public pages (proposal-view.html) should NOT load this script.

const AUTH_URL = SUPABASE_URL + '/auth/v1';
const AUTH_STORAGE_KEY = 'vsdr-auth-session';

// ═══ Session Management ═══

function getSession() {
  try {
    var raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    var session = JSON.parse(raw);
    // Check if expired
    if (session.expires_at && Date.now() / 1000 > session.expires_at) {
      // Try refresh
      return null;
    }
    return session;
  } catch { return null; }
}

function setSession(session) {
  if (!session) { localStorage.removeItem(AUTH_STORAGE_KEY); return; }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function getAccessToken() {
  var s = getSession();
  return s ? s.access_token : null;
}

function getCurrentUser() {
  var s = getSession();
  return s ? s.user : null;
}

// ═══ Auth API Calls ═══

async function authSignIn(email, password) {
  var res = await fetch(AUTH_URL + '/token?grant_type=password', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password })
  });
  if (!res.ok) {
    var err = await res.json().catch(function() { return { error_description: 'Login failed' }; });
    throw new Error(err.error_description || err.msg || 'Login failed');
  }
  var data = await res.json();
  setSession(data);
  return data;
}

async function authSignUp(email, password) {
  var res = await fetch(AUTH_URL + '/signup', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password })
  });
  if (!res.ok) {
    var err = await res.json().catch(function() { return { msg: 'Signup failed' }; });
    throw new Error(err.msg || err.error_description || 'Signup failed');
  }
  return await res.json();
}

async function authSignOut() {
  var token = getAccessToken();
  if (token) {
    await fetch(AUTH_URL + '/logout', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token }
    }).catch(function() {});
  }
  setSession(null);
  location.href = 'login.html';
}

async function authRefreshToken() {
  var s = getSession();
  if (!s || !s.refresh_token) return null;
  var res = await fetch(AUTH_URL + '/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refresh_token })
  });
  if (!res.ok) { setSession(null); return null; }
  var data = await res.json();
  setSession(data);
  return data;
}

// ═══ Auth Guard ═══
// Call this on protected pages to enforce login

async function requireAuth() {
  var session = getSession();
  if (!session) {
    location.href = 'login.html';
    return false;
  }
  // Check if token is expired or about to expire (within 60s)
  if (session.expires_at && Date.now() / 1000 > session.expires_at - 60) {
    var refreshed = await authRefreshToken();
    if (!refreshed) {
      location.href = 'login.html';
      return false;
    }
  }
  // Update Authorization header for all Supabase calls
  if (typeof SB_HEADERS !== 'undefined') {
    SB_HEADERS['Authorization'] = 'Bearer ' + getAccessToken();
  }
  return true;
}

// ═══ Auto-init ═══
// Automatically check auth and update headers on script load
(function() {
  var session = getSession();
  if (session && session.access_token && typeof SB_HEADERS !== 'undefined') {
    SB_HEADERS['Authorization'] = 'Bearer ' + session.access_token;
  }
})();
