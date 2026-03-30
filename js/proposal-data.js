// ── Proposal Data Layer ──
// CRUD operations for proposals, sections, and change requests
// Supabase = primary, localStorage = cache/fallback

const PROPOSALS_LS_KEY = 'vsdr-proposals-cache';
const SECTIONS_LS_KEY = 'vsdr-sections-cache';

// ═══════════════════════════
// Local cache helpers
// ═══════════════════════════

function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.warn('Cache write failed:', e); }
}

function cacheGet(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// ═══════════════════════════
// Proposals
// ═══════════════════════════

async function fetchProposals() {
  try {
    const data = await sbGet('proposals', 'select=*&order=updated_at.desc');
    cacheSet(PROPOSALS_LS_KEY, data);
    return data;
  } catch (e) {
    console.warn('Supabase fetch failed, using cache:', e);
    return cacheGet(PROPOSALS_LS_KEY) || [];
  }
}

async function fetchProposal(id) {
  try {
    const [proposals, sections, crs] = await Promise.all([
      sbGet('proposals', 'id=eq.' + id),
      sbGet('proposal_sections', 'proposal_id=eq.' + id + '&order=sort_order.asc'),
      sbGet('proposal_change_requests', 'proposal_id=eq.' + id + '&order=created_at.asc')
    ]);
    if (!proposals || !proposals.length) return null;
    const proposal = proposals[0];
    proposal.sections = sections || [];
    proposal.change_requests = crs || [];
    cacheSet('vsdr-proposal-' + id, proposal);
    return proposal;
  } catch (e) {
    console.warn('Supabase fetch failed, using cache:', e);
    return cacheGet('vsdr-proposal-' + id);
  }
}

async function fetchProposalByToken(token) {
  try {
    const proposals = await sbGet('proposals', 'share_token=eq.' + token);
    if (!proposals || !proposals.length) return null;
    const p = proposals[0];
    const sections = await sbGet('proposal_sections', 'proposal_id=eq.' + p.id + '&order=sort_order.asc');
    p.sections = sections || [];
    return p;
  } catch (e) {
    console.warn('Supabase fetch failed:', e);
    return null;
  }
}

async function createProposal(data) {
  const rows = await sbInsert('proposals', data, { returnData: true });
  return rows && rows.length ? rows[0] : null;
}

async function updateProposal(id, fields) {
  fields.updated_at = new Date().toISOString();
  const rows = await sbUpdate('proposals', 'id=eq.' + id, fields);
  return rows && rows.length ? rows[0] : null;
}

async function deleteProposal(id) {
  await sbDelete('proposals', 'id=eq.' + id);
  localStorage.removeItem('vsdr-proposal-' + id);
}

// ═══════════════════════════
// Proposal Sections
// ═══════════════════════════

async function createSection(proposalId, data) {
  const section = Object.assign({}, data, {
    proposal_id: proposalId,
    id: data.id || crypto.randomUUID()
  });
  console.log('[createSection] Inserting:', section);
  const rows = await sbInsert('proposal_sections', section, { returnData: true });
  console.log('[createSection] Result:', rows);
  return rows && rows.length ? rows[0] : (rows || null);
}

async function createSectionsBatch(proposalId, sectionsArray) {
  const sections = sectionsArray.map((s, i) => ({
    id: crypto.randomUUID(),
    proposal_id: proposalId,
    sort_order: i + 1,
    title: s.title,
    content_type: s.content_type || 'text',
    content: s.content || '',
    content_json: s.content_json || {},
    status: 'pending',
    image_url: s.image_url || null
  }));
  return sbInsert('proposal_sections', sections, { returnData: true });
}

async function updateSection(sectionId, fields) {
  fields.updated_at = new Date().toISOString();
  const rows = await sbUpdate('proposal_sections', 'id=eq.' + sectionId, fields);
  return rows && rows.length ? rows[0] : null;
}

async function deleteSection(sectionId) {
  await sbDelete('proposal_sections', 'id=eq.' + sectionId);
}

async function reorderSections(proposalId, orderedIds) {
  const promises = orderedIds.map((id, i) =>
    sbUpdate('proposal_sections', 'id=eq.' + id, { sort_order: i + 1 })
  );
  await Promise.all(promises);
}

// ═══════════════════════════
// Change Requests
// ═══════════════════════════

async function createChangeRequest(sectionId, proposalId, message, author) {
  const cr = {
    id: crypto.randomUUID(),
    section_id: sectionId,
    proposal_id: proposalId,
    author: author || 'Yousra',
    message: message,
    status: 'open'
  };
  const rows = await sbInsert('proposal_change_requests', cr, { returnData: true });
  // Also mark the section as change_requested
  await updateSection(sectionId, { status: 'change_requested' });
  return rows && rows.length ? rows[0] : null;
}

async function resolveChangeRequest(crId, resolvedBy, response) {
  return sbUpdate('proposal_change_requests', 'id=eq.' + crId, {
    status: 'resolved',
    resolved_by: resolvedBy || 'Gaby',
    response: response || '',
    resolved_at: new Date().toISOString()
  });
}

async function fetchOpenCRs(proposalId) {
  return sbGet('proposal_change_requests', 'proposal_id=eq.' + proposalId + '&status=eq.open&order=created_at.asc');
}

async function fetchSectionCRs(sectionId) {
  return sbGet('proposal_change_requests', 'section_id=eq.' + sectionId + '&order=created_at.asc');
}

// ═══════════════════════════
// Template generation
// ═══════════════════════════

function getTemplateSections(proposalType, clientName) {
  const templates = {
    'Full Proposal': [
      { title: 'Cover', content_type: 'cover', content_json: { tagline: 'Growth Partnership Proposal', subtitle: 'Prepared exclusively for ' + clientName, confidential: true } },
      { title: 'Executive Summary', content_type: 'text', content: 'Enter the executive summary for this proposal...' },
      { title: 'Our Track Record', content_type: 'metrics', content_json: { metrics: [{ label: 'Metric 1', value: '0', icon: 'rocket', sub: 'Description' }, { label: 'Metric 2', value: '0', icon: 'chart', sub: 'Description' }, { label: 'Metric 3', value: '0', icon: 'target', sub: 'Description' }, { label: 'Metric 4', value: '0', icon: 'network', sub: 'Description' }] } },
      { title: 'The Opportunity', content_type: 'text', content: 'Describe the opportunity and market context...' },
      { title: 'Our Methodology', content_type: 'text', content: 'Detail the approach and methodology...' },
      { title: 'Engagement Timeline', content_type: 'timeline', content_json: { phases: [{ phase: 'Phase 1', weeks: '1-4', color: '#4ECB71' }, { phase: 'Phase 2', weeks: '5-12', color: '#2DD4BF' }, { phase: 'Phase 3', weeks: '13-24', color: '#F59E0B' }] } },
      { title: 'Investment', content_type: 'pricing', content_json: { headers: ['', 'Option A', 'Option B (Rec.)', 'Option C'], recommended: 'Option B (Rec.)', rows: [['Scope', 'Basic', 'Full', 'Premium'], ['Duration', '3 months', '6 months', '12 months'], ['Investment', '$X', '$Y', '$Z']] } },
      { title: 'Why Us', content_type: 'text', content: 'Explain your unique value proposition...' },
      { title: 'Next Steps', content_type: 'text', content: 'Outline the next steps and call to action...' }
    ],
    'Quick Pitch': [
      { title: 'Cover', content_type: 'cover', content_json: { tagline: 'Partnership Proposal', subtitle: 'For ' + clientName } },
      { title: 'The Problem', content_type: 'text', content: 'Define the core problem...' },
      { title: 'Our Solution', content_type: 'text', content: 'Present your solution...' },
      { title: 'Investment', content_type: 'pricing', content_json: { headers: ['', 'Starter', 'Growth'], recommended: 'Growth', rows: [['Duration', '3 months', '6 months'], ['Investment', '$X', '$Y']] } },
      { title: 'Next Steps', content_type: 'text', content: 'Call to action...' }
    ],
    'Case Study': [
      { title: 'Cover', content_type: 'cover', content_json: { tagline: 'Case Study', subtitle: clientName } },
      { title: 'The Challenge', content_type: 'text', content: 'Describe the client challenge...' },
      { title: 'Our Approach', content_type: 'text', content: 'Detail the approach taken...' },
      { title: 'Results', content_type: 'metrics', content_json: { metrics: [{ label: 'Result 1', value: '0', icon: 'chart', sub: 'Description' }, { label: 'Result 2', value: '0', icon: 'target', sub: 'Description' }] } },
      { title: 'Client Testimonial', content_type: 'callout', content: 'Client quote goes here...', content_json: { attribution: 'Client Name, Title' } }
    ]
  };
  return templates[proposalType] || templates['Full Proposal'];
}

// ═══════════════════════════
// Knowledge Base
// ═══════════════════════════

async function fetchKBEntries(filter) {
  return sbGet('knowledge_base', (filter || '') + '&order=created_at.desc');
}

async function searchKB(query) {
  return sbGet('knowledge_base', 'or=(title.ilike.*' + encodeURIComponent(query) + '*,content.ilike.*' + encodeURIComponent(query) + '*)&order=created_at.desc');
}

async function fetchKBByType(contentType) {
  return sbGet('knowledge_base', 'content_type=eq.' + contentType + '&order=created_at.desc');
}

async function fetchKBByFolder(folderId) {
  return sbGet('knowledge_base', 'folder_id=eq.' + folderId + '&order=created_at.desc');
}

async function createKBEntry(data) {
  if (!data.id) data.id = crypto.randomUUID();
  const rows = await sbInsert('knowledge_base', data, { returnData: true });
  return rows && rows.length ? rows[0] : null;
}

async function updateKBEntry(id, fields) {
  fields.updated_at = new Date().toISOString();
  return sbUpdate('knowledge_base', 'id=eq.' + id, fields);
}

async function deleteKBEntry(id) {
  return sbDelete('knowledge_base', 'id=eq.' + id);
}

function generateProposalIndex(existingProposals) {
  const year = new Date().getFullYear();
  const nums = (existingProposals || []).map(p => {
    const m = (p.proposal_index || '').match(/SP-\d+-(\d+)/);
    return m ? parseInt(m[1]) : 0;
  });
  const max = nums.length ? Math.max(...nums) : 0;
  return 'SP-' + year + '-' + String(max + 1).padStart(3, '0');
}
