// Shared client for /api/airtable-sync — handles per-record VIP / follow-up /
// contact-type updates from any page. Provides:
//   - syncContact(payload, opts)  — POSTs to /api/airtable-sync with timeout/retry,
//                                   returns a normalized result envelope.
//   - syncToast(msg, kind)        — bottom-right toast for success/error/warning/info.
//   - withSyncButton(btn, run)    — optimistic UI helper: disables btn while running,
//                                   re-enables after, restores on rejection.
//
// Result envelope:
//   { ok, partial, requestId, httpStatus, supabase?: {ok, ...}, airtable?: {ok, ...},
//     errorMessage?: string }
// `errorMessage` is a single user-facing string assembled from supabase/airtable errors.

(function (global) {
  'use strict';

  var DEFAULT_TIMEOUT_MS = 12000;
  var CLIENT_RETRIES = 1; // server already retries; one extra client retry covers the cold-start case

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function buildErrorMessage(body) {
    var parts = [];
    if (body && body.supabase && body.supabase.ok === false) {
      parts.push('Supabase: ' + (body.supabase.error || ('HTTP ' + body.supabase.status)));
    }
    if (body && body.airtable && body.airtable.ok === false) {
      parts.push('Airtable: ' + (body.airtable.error || ('HTTP ' + body.airtable.status)));
    }
    if (!parts.length && body && body.error) parts.push(body.error);
    return parts.join(' · ');
  }

  async function syncContact(payload, opts) {
    opts = opts || {};
    var timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    var retries = typeof opts.retries === 'number' ? opts.retries : CLIENT_RETRIES;

    for (var attempt = 0; attempt <= retries; attempt++) {
      var ctrl = new AbortController();
      var timeoutId = setTimeout(function () { ctrl.abort(); }, timeoutMs);
      try {
        var resp = await fetch('/api/airtable-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal
        });
        clearTimeout(timeoutId);

        var body = null;
        try { body = await resp.json(); } catch (_) { body = {}; }

        // 502 means total downstream failure — retry once if budget allows.
        if (resp.status === 502 && attempt < retries) {
          await sleep(Math.pow(2, attempt) * 600);
          continue;
        }

        var ok = resp.ok && body && body.ok === true;
        var envelope = Object.assign({}, body || {}, {
          ok: ok,
          httpStatus: resp.status
        });
        if (!ok) envelope.errorMessage = buildErrorMessage(body) || ('HTTP ' + resp.status);
        return envelope;
      } catch (e) {
        clearTimeout(timeoutId);
        var isAbort = e && e.name === 'AbortError';
        if (attempt < retries) { await sleep(Math.pow(2, attempt) * 600); continue; }
        return {
          ok: false,
          httpStatus: 0,
          errorMessage: isAbort ? 'Request timed out' : ((e && e.message) || 'Network error')
        };
      }
    }
  }

  // Toast (bottom-right). Single shared element, replaces previous.
  function syncToast(message, kind) {
    var el = document.getElementById('sync-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sync-toast';
      el.setAttribute('role', 'status');
      el.style.cssText = [
        'position:fixed', 'bottom:24px', 'right:24px',
        'padding:14px 20px', 'border-radius:8px',
        "font-family:var(--body, 'General Sans', sans-serif)",
        'font-size:13px', 'font-weight:500', 'line-height:1.5',
        'z-index:9999', 'max-width:380px',
        'box-shadow:0 8px 24px rgba(0,0,0,0.3)',
        'transition:opacity 0.25s ease, transform 0.25s ease',
        'opacity:0', 'transform:translateY(8px)', 'pointer-events:none'
      ].join(';') + ';';
      document.body.appendChild(el);
    }
    var palette = {
      success: { bg: 'rgba(78,203,113,0.95)',  fg: '#0F1923' },
      error:   { bg: 'rgba(239,68,68,0.95)',   fg: '#FFFFFF' },
      warning: { bg: 'rgba(245,158,11,0.95)',  fg: '#0F1923' },
      info:    { bg: 'rgba(45,212,191,0.95)',  fg: '#0F1923' }
    };
    var c = palette[kind] || palette.info;
    el.style.background = c.bg;
    el.style.color = c.fg;
    el.textContent = message;
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    if (el._hideTimer) clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
    }, kind === 'error' ? 6000 : 3500);
  }

  // Disable a button (or HTMLElement) while `run` is in flight.
  // `run` is an async function that receives no args and returns the sync envelope.
  // Returns whatever `run` resolves to.
  async function withSyncButton(btn, run) {
    var wasDisabled = btn ? btn.disabled : false;
    var prevAria = btn ? btn.getAttribute('aria-busy') : null;
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('is-syncing');
    }
    try {
      return await run();
    } finally {
      if (btn) {
        btn.disabled = wasDisabled;
        if (prevAria === null) btn.removeAttribute('aria-busy'); else btn.setAttribute('aria-busy', prevAria);
        btn.classList.remove('is-syncing');
      }
    }
  }

  global.syncContact = syncContact;
  global.syncToast = syncToast;
  global.withSyncButton = withSyncButton;
})(typeof window !== 'undefined' ? window : globalThis);
