// ── Proposal Section Renderers ──
// Pure functions returning HTML strings. Used by editor, client view, and PDF export.
// Handles both legacy (NovaTech seed) and new data formats.

const SECTION_ICONS = {
  rocket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  network: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
};

const METRIC_ACCENTS = ['#4ECB71', '#2DD4BF', '#F59E0B', '#A78BFA', '#EF4444', '#FBBF24'];

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Cover Page ───
function renderCoverPage(proposal, section) {
  const cj = section.content_json || {};
  const tagline = cj.tagline || proposal.title || 'Proposal';
  const subtitle = cj.subtitle || ('Prepared for ' + (proposal.client_name || 'Client'));
  const date = new Date(proposal.created_at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const ref = proposal.proposal_index || '';
  const showLogo = cj.show_logo !== false;
  const align = cj.align || 'left';
  const alignStyle = align === 'center' ? 'align-items:center;text-align:center;' : 'align-items:flex-start;text-align:left;';

  return '<div class="cover-page" style="' + alignStyle + '">' +
    (showLogo ? '<div class="cover-brand">' +
      '<div class="cover-logo">SPRINTLY<span>PARTNERS</span></div>' +
    '</div>' : '') +
    '<div class="cover-content">' +
      '<h1 class="cover-title" style="text-align:' + align + '">' + escHtml(tagline) + '</h1>' +
      '<p class="cover-subtitle" style="text-align:' + align + '">' + escHtml(subtitle) + '</p>' +
      '<div class="cover-meta">' +
        '<div class="cover-meta-item"><span class="cover-meta-label">Date</span><span>' + date + '</span></div>' +
        '<div class="cover-meta-item"><span class="cover-meta-label">Reference</span><span>' + escHtml(ref) + '</span></div>' +
        (cj.confidential !== false ? '<div class="cover-meta-item"><span class="cover-meta-label">Classification</span><span>Confidential</span></div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="cover-accent-bar"></div>' +
  '</div>';
}

// ─── Text Section ───
function renderText(section) {
  const content = section.content || '';
  const paragraphs = content.split('\n\n').filter(Boolean);
  let html = '<div class="sec-text">';
  html += paragraphs.map(p => '<p>' + escHtml(p).replace(/\n/g, '<br>') + '</p>').join('');

  if (section.callout_text || (section.content_json && section.content_json.callout_text)) {
    const ct = section.callout_text || section.content_json.callout_text;
    const ca = section.callout_attribution || (section.content_json && section.content_json.callout_attribution) || '';
    html += '<blockquote class="sec-callout-inline">';
    html += '<p>' + escHtml(ct) + '</p>';
    if (ca) html += '<cite>' + escHtml(ca) + '</cite>';
    html += '</blockquote>';
  }

  if (section.image_url) {
    html += '<div class="sec-image-inline"><img src="' + section.image_url + '" alt="' + escHtml(section.title) + '" loading="lazy"></div>';
  }

  html += '</div>';
  return html;
}

// ─── Table / Pricing ───
function renderTable(section) {
  const td = section.table_data || section.content_json || {};
  const headers = td.headers || [];
  const rows = td.rows || [];
  const rec = td.recommended || '';
  const isPricing = section.content_type === 'pricing';
  const recIdx = rec ? headers.indexOf(rec) : -1;

  let html = '<div class="sec-table-wrap' + (isPricing ? ' sec-pricing' : '') + '"><table class="sec-table">';

  if (headers.length) {
    html += '<thead><tr>';
    headers.forEach((h, i) => {
      const cls = (i === recIdx) ? ' class="rec-col"' : '';
      html += '<th' + cls + '>' + escHtml(h);
      if (i === recIdx) html += ' <span class="rec-badge">Recommended</span>';
      html += '</th>';
    });
    html += '</tr></thead>';
  }

  html += '<tbody>';
  rows.forEach((row, ri) => {
    const isLastRow = ri === rows.length - 1;
    html += '<tr' + (isLastRow && isPricing ? ' class="price-row"' : '') + '>';
    (Array.isArray(row) ? row : [row]).forEach((cell, ci) => {
      const cls = (ci === recIdx) ? ' class="rec-col"' : '';
      html += '<td' + cls + '>' + escHtml(cell) + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

// ─── Metrics ───
function renderMetrics(section) {
  const raw = section.metrics_data || section.content_json || {};
  // Legacy format: flat array [{label, value, icon, sub}]
  // New format: {metrics: [...], roi: {...}}
  let metrics = [];
  if (Array.isArray(raw)) {
    metrics = raw;
  } else if (raw.metrics && Array.isArray(raw.metrics)) {
    metrics = raw.metrics;
  } else if (Array.isArray(section.content_json)) {
    metrics = section.content_json;
  }

  if (!metrics.length) return '<div class="sec-empty">No metrics data</div>';

  let html = '<div class="sec-metrics-grid">';
  metrics.forEach((m, i) => {
    const accent = METRIC_ACCENTS[i % METRIC_ACCENTS.length];
    const icon = SECTION_ICONS[m.icon] || SECTION_ICONS.chart;
    html += '<div class="metric-card" style="--accent:' + accent + '">';
    html += '<div class="metric-icon">' + icon + '</div>';
    html += '<div class="metric-value">' + escHtml(m.value) + '</div>';
    html += '<div class="metric-label">' + escHtml(m.label) + '</div>';
    if (m.sub) html += '<div class="metric-sub">' + escHtml(m.sub).replace(/\n/g, '<br>') + '</div>';
    html += '</div>';
  });
  html += '</div>';

  // ROI section (new format)
  if (raw.roi) {
    html += '<div class="sec-roi-grid">';
    ['conservative', 'target', 'stretch'].forEach(key => {
      if (raw.roi[key]) {
        html += '<div class="roi-card roi-' + key + '">';
        html += '<div class="roi-label">' + key.charAt(0).toUpperCase() + key.slice(1) + '</div>';
        html += '<div class="roi-value">' + escHtml(raw.roi[key]) + '</div>';
        html += '</div>';
      }
    });
    html += '</div>';
  }

  return html;
}

// ─── Timeline / Gantt ───
function renderTimeline(section) {
  const raw = section.timeline_data || section.content_json || {};
  // Legacy: [{phase, weeks, color}]  e.g. {phase: 'Diagnostic', weeks: '1-3', color: '#4ECB71'}
  // New: {phases: [{name, start, end}]}
  let phases = [];

  if (Array.isArray(raw)) {
    phases = raw;
  } else if (raw.phases && Array.isArray(raw.phases)) {
    phases = raw.phases;
  } else if (Array.isArray(section.content_json)) {
    phases = section.content_json;
  }

  if (!phases.length) return '<div class="sec-empty">No timeline data</div>';

  // Detect format
  const isWeekFormat = phases[0] && (phases[0].weeks !== undefined);

  let totalWeeks = 48;
  let bars = [];

  if (isWeekFormat) {
    // Parse week ranges
    let maxWeek = 0;
    phases.forEach(p => {
      const parts = (p.weeks || '').split('-').map(Number);
      const start = parts[0] || 1;
      const end = parts[1] || start;
      if (end > maxWeek) maxWeek = end;
      bars.push({ name: p.phase || p.name, start, end, color: p.color || '#4ECB71' });
    });
    totalWeeks = maxWeek || 48;
  } else {
    // ISO date format — convert to week-based
    const allDates = [];
    phases.forEach(p => {
      if (p.start) allDates.push(new Date(p.start));
      if (p.end) allDates.push(new Date(p.end));
    });
    if (!allDates.length) return '<div class="sec-empty">Invalid timeline data</div>';

    const minDate = new Date(Math.min(...allDates));
    phases.forEach((p, i) => {
      const s = new Date(p.start || p.startDate);
      const e = new Date(p.end || p.endDate);
      const startWeek = Math.floor((s - minDate) / (7 * 86400000)) + 1;
      const endWeek = Math.ceil((e - minDate) / (7 * 86400000)) + 1;
      bars.push({ name: p.name || p.phase, start: startWeek, end: endWeek, color: METRIC_ACCENTS[i % METRIC_ACCENTS.length] });
    });
    const maxEnd = bars.reduce((m, b) => Math.max(m, b.end), 0);
    totalWeeks = maxEnd || 48;
  }

  let html = '<div class="sec-gantt">';
  html += '<div class="gantt-header"><span>Phase</span><span>Timeline</span></div>';
  bars.forEach(bar => {
    const leftPct = ((bar.start - 1) / totalWeeks * 100).toFixed(1);
    const widthPct = ((bar.end - bar.start + 1) / totalWeeks * 100).toFixed(1);
    html += '<div class="gantt-row">';
    html += '<div class="gantt-label">' + escHtml(bar.name) + '</div>';
    html += '<div class="gantt-track">';
    html += '<div class="gantt-bar" style="left:' + leftPct + '%;width:' + widthPct + '%;background:' + bar.color + '">';
    html += '<span class="gantt-bar-label">Wk ' + bar.start + '-' + bar.end + '</span>';
    html += '</div></div></div>';
  });

  // Week markers
  html += '<div class="gantt-markers">';
  const step = totalWeeks <= 12 ? 2 : totalWeeks <= 24 ? 4 : 8;
  for (let w = 1; w <= totalWeeks; w += step) {
    const pct = ((w - 1) / totalWeeks * 100).toFixed(1);
    html += '<span class="gantt-marker" style="left:' + pct + '%">W' + w + '</span>';
  }
  html += '</div>';
  html += '</div>';
  return html;
}

// ─── Callout ───
function renderCallout(section) {
  const content = section.content || section.callout_text || '';
  const attr = section.callout_attribution || (section.content_json && section.content_json.attribution) || '';
  return '<blockquote class="sec-callout">' +
    '<div class="callout-mark">"</div>' +
    '<p>' + escHtml(content) + '</p>' +
    (attr ? '<cite>— ' + escHtml(attr) + '</cite>' : '') +
  '</blockquote>';
}

// ─── Image ───
function renderImage(section) {
  const url = section.image_url || '';
  const caption = section.content || (section.content_json && section.content_json.caption) || '';
  if (!url) return '<div class="sec-image-empty"><span>No image uploaded</span></div>';
  return '<figure class="sec-image">' +
    '<img src="' + url + '" alt="' + escHtml(section.title) + '" loading="lazy">' +
    (caption ? '<figcaption>' + escHtml(caption) + '</figcaption>' : '') +
  '</figure>';
}

// ─── Divider ───
function renderDivider() {
  return '<div class="sec-divider"><div class="divider-line"></div></div>';
}

// ─── Pricing (alias for table with pricing styling) ───
function renderPricing(section) {
  return renderTable(section);
}

// ─── Master dispatcher ───
function renderSectionContent(section, proposal) {
  switch (section.content_type) {
    case 'cover': return renderCoverPage(proposal || {}, section);
    case 'text': return renderText(section);
    case 'table': return renderTable(section);
    case 'pricing': return renderPricing(section);
    case 'metrics': return renderMetrics(section);
    case 'timeline': return renderTimeline(section);
    case 'callout': return renderCallout(section);
    case 'image': return renderImage(section);
    case 'divider': return renderDivider();
    default: return '<div class="sec-empty">Unknown section type: ' + escHtml(section.content_type) + '</div>';
  }
}

// ─── Section type metadata ───
const SECTION_TYPES = [
  { type: 'cover', label: 'Cover Page', icon: '🎨', desc: 'Full-bleed title page with branding' },
  { type: 'text', label: 'Text', icon: '📝', desc: 'Rich text paragraphs with optional callout' },
  { type: 'table', label: 'Table', icon: '📊', desc: 'Data table with columns and rows' },
  { type: 'pricing', label: 'Pricing Table', icon: '💰', desc: 'Investment options with recommended highlight' },
  { type: 'metrics', label: 'Metrics', icon: '📈', desc: 'KPI cards with visual accents' },
  { type: 'timeline', label: 'Timeline', icon: '📅', desc: 'Gantt-style phase timeline' },
  { type: 'callout', label: 'Callout', icon: '💡', desc: 'Highlighted quote or key message' },
  { type: 'image', label: 'Image', icon: '🖼️', desc: 'Visual with optional caption' },
  { type: 'divider', label: 'Divider', icon: '➖', desc: 'Visual separator between sections' }
];
