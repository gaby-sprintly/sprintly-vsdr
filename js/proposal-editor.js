// ── Proposal Editor Logic ──
// Extracted from proposal.html inline script (I5)
// Depends on: supabase-client.js, proposal-data.js, proposal-renderers.js, sidebar.js

initSidebar('proposals');

var P = null, secs = [], crs = [], comments = [], activeSecId = null;
var saveQ = new Map(), saveTmr = null;
var proposalId = new URLSearchParams(location.search).get('id');
if (!proposalId) location.href = 'proposals.html';

// ═══ Data ═══
async function load() {
  try {
    var d = await fetchProposal(proposalId);
    if (!d) { showToast('Proposal not found','error'); return; }
    P = d; secs = d.sections || []; crs = d.change_requests || [];
    try { comments = await fetchComments(proposalId) || []; } catch(e) { comments = []; }
    renderAll();
  } catch(e) { console.error(e); showToast('Load failed','error'); }
}
async function refreshProposal() {
  showToast('Refreshing...','success'); await load();
}

// ═══ Render ═══
function renderAll() { renderTopBar(); renderNav(); renderPreview(); }

function renderTopBar() {
  document.getElementById('topIndex').textContent = P.proposal_index || '';
  document.getElementById('topTitle').value = P.title || 'Untitled';
  document.getElementById('topClient').textContent = P.client_name || '';
  document.getElementById('topStatus').value = P.status || 'draft';
  document.title = (P.title || 'Proposal') + ' — VSDR';
}

var SI = { pending:'⏳', edited:'✏️', change_requested:'🔴', approved:'✅' };

function renderNav() {
  document.getElementById('secNavList').innerHTML = secs.map(function(s,i) {
    return '<li class="sec-nav-item' + (s.id===activeSecId?' active':'') + '" onclick="selectSection(\''+s.id+'\')">' +
      '<span style="font-size:10px">'+(SI[s.status]||'⏳')+'</span>' +
      '<span>'+(i+1)+'. '+esc(s.title||'Untitled')+'</span></li>';
  }).join('');
}

function isSectionEmpty(s) {
  if (s.content_type === 'cover' || s.content_type === 'divider') return false;
  if (s.content_type === 'text' || s.content_type === 'callout') {
    var c = (s.content || '').trim();
    return !c || c.startsWith('Enter ') || c.startsWith('Describe ') || c.startsWith('Detail ') || c.startsWith('Define ') || c.startsWith('Present ') || c.startsWith('Explain ') || c.startsWith('Outline ') || c.startsWith('Client quote');
  }
  if (s.content_type === 'metrics') {
    var md = s.metrics_data || s.content_json || {};
    var arr = Array.isArray(md) ? md : (md.metrics || []);
    return !arr.length || (arr.length && arr[0] && arr[0].value === '0');
  }
  if (s.content_type === 'timeline') {
    var td = s.timeline_data || s.content_json || {};
    var phases = Array.isArray(td) ? td : (td.phases || []);
    return !phases.length;
  }
  if (s.content_type === 'table' || s.content_type === 'pricing') {
    var tb = s.table_data || s.content_json || {};
    return !(tb.rows && tb.rows.length);
  }
  if (s.content_type === 'image') return !s.image_url;
  return false;
}

function renderPreview() {
  var h = '', num = 0, emptyCount = 0;
  secs.forEach(function(s) {
    var empty = isSectionEmpty(s);
    if (empty) emptyCount++;
    h += '<div class="sec-wrap'+(s.id===activeSecId?' active':'')+'" data-id="'+s.id+'" draggable="true" onclick="selectSection(\''+s.id+'\')" ondragstart="dragStart(event,\''+s.id+'\')" ondragend="dragEnd(event)" ondragover="dragOver(event)" ondrop="dropSec(event,\''+s.id+'\')">';
    if (s.content_type === 'cover') {
      h += renderSectionContent(s, P);
    } else if (s.content_type === 'divider') {
      h += '<div style="padding:16px 0">' + renderDivider() + '</div>';
    } else {
      num++;
      h += '<div style="padding:28px 24px">';
      h += '<div class="section-heading"><div class="section-num">'+String(num).padStart(2,'0')+'</div>';
      h += '<h2 class="section-title-text">'+esc(s.title||'')+'</h2></div>';
      h += renderSectionContent(s, P);
      if (empty) {
        h += '<div class="gaby-fill-sec" onclick="event.stopPropagation();gabyFillSection(\''+s.id+'\')">🤖 Ask Gaby to fill this section</div>';
      }
      h += '</div>';
    }
    h += '<div class="sec-strip '+s.status+'"></div></div>';
  });
  if (!secs.length) h = '<div style="text-align:center;padding:80px 0"><div style="font-size:48px;opacity:0.3">📝</div><p style="color:#64748B;margin:16px 0">No sections yet.</p><button class="sp-btn save" onclick="openAddModal()">+ Add Section</button></div>';
  document.getElementById('previewInner').innerHTML = h;
  var fillAllBtn = document.getElementById('gabyFillAll');
  if (fillAllBtn) {
    if (emptyCount > 0) fillAllBtn.classList.add('visible');
    else fillAllBtn.classList.remove('visible');
  }
}

// ═══ Side Panel ═══
function selectSection(id) {
  activeSecId = id;
  renderNav(); renderPreview(); openPanel(id);
}

function openPanel(id) {
  var s = secs.find(function(x){return x.id===id;});
  if (!s) return;
  var panel = document.getElementById('sidePanel');
  document.getElementById('spTitle').textContent = esc(s.title || 'Edit Section');
  document.getElementById('spBody').innerHTML = buildPanelContent(s);
  panel.classList.add('open');
  document.getElementById('editorPreview').classList.add('panel-open');
}

function closePanel() {
  activeSecId = null;
  document.getElementById('sidePanel').classList.remove('open');
  document.getElementById('editorPreview').classList.remove('panel-open');
  renderNav(); renderPreview();
}

function buildPanelContent(s) {
  var id = s.id, h = '';
  h += '<div class="sp-section"><span class="sp-label">Section Title</span>';
  h += '<input class="sp-input" value="'+escA(s.title||'')+'" onchange="saveSTitle(\''+id+'\',this.value)" /></div>';
  h += '<div class="sp-section"><span class="sp-label">Type</span><span style="color:#A78BFA;font-size:13px;text-transform:uppercase;letter-spacing:0.5px">'+esc(s.content_type)+'</span></div>';
  h += '<div class="sp-section"><span class="sp-label">Content</span>';
  if (s.content_type==='text'||s.content_type==='callout') {
    h += '<textarea class="sp-textarea" id="spText-'+id+'" onblur="saveText(\''+id+'\')">'+esc(s.content||'')+'</textarea>';
  } else if (s.content_type==='table'||s.content_type==='pricing') {
    h += buildTableEditor(s);
  } else if (s.content_type==='image') {
    h += buildImageEditor(s);
  } else if (s.content_type==='cover'||s.content_type==='divider') {
    h += '<p style="color:#64748B;font-size:13px">Auto-generated from proposal metadata.</p>';
  } else {
    var data = s.metrics_data||s.timeline_data||s.table_data||s.content_json||{};
    h += '<textarea class="sp-json" id="spJson-'+id+'">'+esc(JSON.stringify(data,null,2))+'</textarea>';
    h += '<div class="sp-actions"><button class="sp-btn save" onclick="saveJson(\''+id+'\',\''+s.content_type+'\')">Apply Changes</button></div>';
  }
  h += '</div>';
  h += '<div class="sp-divider"></div>';
  h += '<div class="sp-section"><span class="sp-label">Status</span><div class="sp-actions">';
  if (s.status!=='approved') h += '<button class="sp-btn approve" onclick="approveSec(\''+id+'\')">✅ Approve Section</button>';
  else h += '<span style="color:#4ECB71;font-size:13px">✅ Approved</span>';
  h += '</div></div>';
  h += '<div class="sp-divider"></div>';
  h += buildChatPanel(s);
  h += '<div class="sp-divider"></div>';
  h += '<div class="sp-section"><button class="sp-btn delete" onclick="delSec(\''+id+'\')">Delete Section</button></div>';
  return h;
}

function buildTableEditor(s) {
  var td = s.table_data||s.content_json||{}, headers=td.headers||[], rows=td.rows||[], rec=td.recommended||'';
  var recIdx = rec ? headers.indexOf(rec) : -1;
  var h = '<div style="overflow-x:auto"><table class="sp-table-edit" data-sid="'+s.id+'">';
  if (headers.length) { h+='<thead><tr>'; headers.forEach(function(c){h+='<th contenteditable="true">'+esc(c)+'</th>';}); h+='</tr></thead>'; }
  h+='<tbody>';
  rows.forEach(function(row){ h+='<tr>'; (Array.isArray(row)?row:[row]).forEach(function(c){h+='<td contenteditable="true">'+esc(c)+'</td>';}); h+='</tr>'; });
  h+='</tbody></table></div>';
  h+='<div class="sp-actions" style="margin-top:8px"><button class="sp-btn save" onclick="saveTable(\''+s.id+'\')">Save Table</button></div>';
  return h;
}

function buildImageEditor(s) {
  var h='';
  if (s.image_url) {
    h+='<img src="'+s.image_url+'" style="max-width:100%;border-radius:4px;margin-bottom:8px">';
    h+='<div class="sp-actions"><button class="sp-btn save" onclick="trigImg(\''+s.id+'\')">Replace</button><button class="sp-btn delete" onclick="rmImg(\''+s.id+'\')">Remove</button></div>';
  } else {
    h+='<div class="sp-img-zone" onclick="trigImg(\''+s.id+'\')">🖼️ Click to upload image</div>';
  }
  h+='<input type="file" accept="image/*" style="display:none" id="imgIn-'+s.id+'" onchange="doImg(\''+s.id+'\',this)">';
  return h;
}

function buildChatPanel(s) {
  var myCrs = crs.filter(function(c){return c.section_id===s.id;});
  var myComments = comments.filter(function(c){return c.section_id===s.id;});
  var h = '';
  h += '<div class="sp-section"><span class="sp-chat-title">⚡ Change Requests ('+myCrs.length+')</span>';
  if (myCrs.length) {
    h += '<div class="sp-chat-msgs">';
    myCrs.forEach(function(cr) {
      var isG = (cr.author||'').toLowerCase()==='gaby';
      var t = cr.created_at ? new Date(cr.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
      h += '<div class="sp-msg'+(isG?' gaby':'')+'">';
      h += '<div class="sp-msg-author">'+esc(cr.author)+'<span class="sp-msg-time">'+t+'</span></div>';
      h += '<div class="sp-msg-text">'+esc(cr.message)+'</div>';
      if (cr.status==='resolved') { h+='<span class="sp-msg-resolved">Resolved</span>'; if(cr.response) h+='<div class="sp-msg-text" style="margin-top:4px;color:#4ECB71;font-size:12px">'+esc(cr.response)+'</div>'; }
      h += '</div>';
    });
    h += '</div>';
  } else {
    h += '<p style="font-size:12px;color:#64748B;margin-bottom:8px">No change requests yet.</p>';
  }
  h += '<div class="sp-chat-input"><input id="crIn-'+s.id+'" placeholder="Tell Gaby what to change..." onkeydown="if(event.key===\'Enter\')sendCR(\''+s.id+'\')" /><button onclick="sendCR(\''+s.id+'\')">Send</button></div>';
  h += '</div>';
  h += '<div class="sp-divider"></div>';
  h += '<div class="sp-section"><span class="sp-chat-title">💬 Comments ('+myComments.length+')</span>';
  if (myComments.length) {
    h += '<div class="sp-chat-msgs">';
    myComments.forEach(function(c) {
      var t = c.created_at ? new Date(c.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
      h += '<div class="sp-msg">';
      h += '<div class="sp-msg-author">'+esc(c.author)+'<span class="sp-msg-time">'+t+'</span></div>';
      h += '<div class="sp-msg-text" style="background:rgba(167,139,250,0.06);border-left:2px solid #A78BFA">'+esc(c.message)+'</div>';
      h += '</div>';
    });
    h += '</div>';
  } else {
    h += '<p style="font-size:12px;color:#64748B;margin-bottom:8px">No comments yet.</p>';
  }
  h += '<div class="sp-chat-input"><input id="cmtIn-'+s.id+'" placeholder="Add a note or comment..." onkeydown="if(event.key===\'Enter\')sendComment(\''+s.id+'\')" /><button style="background:#A78BFA" onclick="sendComment(\''+s.id+'\')">Note</button></div>';
  h += '</div>';
  return h;
}

// ═══ Save operations ═══
function esc(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'';}
function escA(s){return s?String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;'):'';}
function scrollToSection(id){ var el=document.querySelector('[data-id="'+id+'"]'); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }

document.getElementById('topTitle').addEventListener('change',async function(){
  if(!P)return; try{await updateProposal(P.id,{title:this.value});P.title=this.value;saved();}catch(e){showToast('Failed','error');}
});

async function saveSTitle(id,v){
  try{await updateSection(id,{title:v});var s=secs.find(function(x){return x.id===id;});if(s)s.title=v;renderNav();renderPreview();saved();}catch(e){showToast('Failed','error');}
}

function saveText(id){
  var ta=document.getElementById('spText-'+id); if(!ta)return;
  var s=secs.find(function(x){return x.id===id;}); if(s)s.content=ta.value;
  qSave(id,{content:ta.value});
  renderPreview();
}

async function saveJson(id,type){
  var ta=document.getElementById('spJson-'+id); if(!ta)return;
  try{
    var data=JSON.parse(ta.value), fields={content_json:data};
    if(type==='metrics')fields.metrics_data=data;
    else if(type==='timeline')fields.timeline_data=data;
    else if(type==='table'||type==='pricing')fields.table_data=data;
    await updateSection(id,fields);
    var s=secs.find(function(x){return x.id===id;}); if(s)Object.assign(s,fields);
    renderPreview(); saved();
  }catch(e){showToast('Invalid JSON: '+e.message,'error');}
}

function saveTable(id){
  var tbl=document.querySelector('.sp-table-edit[data-sid="'+id+'"]'); if(!tbl)return;
  var headers=[],rows=[];
  tbl.querySelectorAll('thead th').forEach(function(th){headers.push(th.textContent.trim());});
  tbl.querySelectorAll('tbody tr').forEach(function(tr){var r=[];tr.querySelectorAll('td').forEach(function(td){r.push(td.textContent.trim());});rows.push(r);});
  var s=secs.find(function(x){return x.id===id;}); var old=s?(s.table_data||s.content_json||{}):{};
  var td={headers:headers,rows:rows,recommended:old.recommended||''};
  if(s){s.table_data=td;s.content_json=td;}
  qSave(id,{table_data:td,content_json:td});
  renderPreview(); saved();
}

function trigImg(id){document.getElementById('imgIn-'+id).click();}
function doImg(id,input){if(input.files[0]){var r=new FileReader();r.onload=function(e){var s=secs.find(function(x){return x.id===id;});if(s)s.image_url=e.target.result;qSave(id,{image_url:e.target.result});renderPreview();openPanel(id);};r.onerror=function(){showToast('Image read failed','error');};r.readAsDataURL(input.files[0]);}}
function rmImg(id){var s=secs.find(function(x){return x.id===id;});if(s)s.image_url=null;qSave(id,{image_url:null});renderPreview();openPanel(id);}

async function approveSec(id){
  try{await updateSection(id,{status:'approved'});var s=secs.find(function(x){return x.id===id;});if(s)s.status='approved';renderAll();openPanel(id);showToast('Approved','success');}catch(e){showToast('Failed','error');}
}

async function changeStatus(v){
  try{await updateProposal(P.id,{status:v});P.status=v;saved();}catch(e){showToast('Failed','error');}
}

async function sendCR(id){
  var input=document.getElementById('crIn-'+id);if(!input)return;var msg=input.value.trim();if(!msg)return;
  try{var cr=await createChangeRequest(id,P.id,msg,'Yousra');crs.push(cr);var s=secs.find(function(x){return x.id===id;});if(s)s.status='change_requested';renderAll();openPanel(id);showToast('Sent to Gaby','success');}catch(e){showToast('Failed: '+e.message,'error');}
}

async function sendComment(id){
  var input=document.getElementById('cmtIn-'+id);if(!input)return;var msg=input.value.trim();if(!msg)return;
  try{
    var rows=await createComment(P.id,id,msg,'Yousra');
    if(rows&&rows.length) comments.push(rows[0]);
    else if(rows) comments.push(rows);
    input.value='';
    openPanel(id);
    showToast('Comment added','success');
  }catch(e){showToast('Failed: '+e.message,'error');}
}

// ═══ Add/Delete — multi-select ═══
var selectedTypes = [];

function openAddModal(){
  selectedTypes = [];
  document.getElementById('addGrid').innerHTML=SECTION_TYPES.map(function(t){
    return '<div class="add-sec-option" data-type="'+t.type+'" onclick="toggleAddType(this,\''+t.type+'\')">' +
      '<div class="add-sec-icon">'+t.icon+'</div><div class="add-sec-label">'+t.label+'</div><div class="add-sec-desc">'+t.desc+'</div></div>';
  }).join('');
  updateAddUI();
  document.getElementById('addModal').classList.add('open');
}
function closeAddModal(){document.getElementById('addModal').classList.remove('open');selectedTypes=[];}
document.getElementById('addModal').addEventListener('click',function(e){if(e.target.id==='addModal')closeAddModal();});

function toggleAddType(el, type) {
  var idx = selectedTypes.indexOf(type);
  if (idx === -1) { selectedTypes.push(type); el.classList.add('selected'); }
  else { selectedTypes.splice(idx, 1); el.classList.remove('selected'); }
  updateAddUI();
}

function updateAddUI() {
  var sel = document.getElementById('addSelected');
  var btn = document.getElementById('btnAddSecs');
  if (selectedTypes.length === 0) {
    sel.style.display = 'none'; btn.style.display = 'none';
  } else {
    var names = selectedTypes.map(function(t){ var info = SECTION_TYPES.find(function(x){return x.type===t;}); return info ? info.label : t; });
    sel.style.display = 'block'; btn.style.display = 'inline-flex';
    sel.textContent = selectedTypes.length + ' selected: ' + names.join(', ');
    btn.textContent = 'Add ' + selectedTypes.length + ' Section' + (selectedTypes.length > 1 ? 's' : '');
  }
}

async function addSelectedSections() {
  if (!selectedTypes.length) return;
  var btn = document.getElementById('btnAddSecs');
  btn.disabled = true; btn.textContent = 'Adding...';
  var added = [];
  try {
    for (var i = 0; i < selectedTypes.length; i++) {
      var type = selectedTypes[i];
      var info = SECTION_TYPES.find(function(t){return t.type===type;}) || {};
      var s = await createSection(P.id, {
        sort_order: secs.length + 1 + i,
        title: info.label || type,
        content_type: type,
        content: type==='text'||type==='callout' ? '' : null,
        content_json: {},
        status: 'pending'
      });
      if (s) { secs.push(s); added.push(s); }
    }
    closeAddModal(); renderAll();
    if (added.length) selectSection(added[0].id);
    showToast(added.length + ' section' + (added.length>1?'s':'') + ' added', 'success');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function delSec(id){
  if(!confirm('Delete this section?'))return;
  try{await deleteSection(id);secs=secs.filter(function(s){return s.id!==id;});crs=crs.filter(function(c){return c.section_id!==id;});closePanel();renderAll();showToast('Deleted','success');}catch(e){showToast('Failed','error');}
}

// ═══ Drag and drop reorder ═══
var draggedId = null;

function dragStart(e, id) {
  draggedId = id;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
}

function dragEnd(e) {
  e.target.classList.remove('dragging');
  draggedId = null;
  document.querySelectorAll('.drop-indicator').forEach(function(el) { el.remove(); });
}

function dragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var wrap = e.target.closest('.sec-wrap');
  if (!wrap || wrap.dataset.id === draggedId) return;
  document.querySelectorAll('.drop-indicator').forEach(function(el) { el.remove(); });
  var rect = wrap.getBoundingClientRect();
  var mid = rect.top + rect.height / 2;
  var indicator = document.createElement('div');
  indicator.className = 'drop-indicator';
  if (e.clientY < mid) {
    wrap.insertAdjacentElement('beforebegin', indicator);
  } else {
    wrap.insertAdjacentElement('afterend', indicator);
  }
}

async function dropSec(e, targetId) {
  e.preventDefault();
  document.querySelectorAll('.drop-indicator').forEach(function(el) { el.remove(); });
  if (!draggedId || draggedId === targetId) return;
  var fromIdx = secs.findIndex(function(s) { return s.id === draggedId; });
  var toIdx = secs.findIndex(function(s) { return s.id === targetId; });
  if (fromIdx === -1 || toIdx === -1) return;
  var wrap = document.querySelector('[data-id="' + targetId + '"]');
  if (wrap) {
    var rect = wrap.getBoundingClientRect();
    if (e.clientY > rect.top + rect.height / 2) toIdx++;
  }
  if (fromIdx < toIdx) toIdx--;
  var moved = secs.splice(fromIdx, 1)[0];
  secs.splice(toIdx, 0, moved);
  renderAll();
  showToast('Section moved', 'success');
  try {
    var ids = secs.map(function(s) { return s.id; });
    await reorderSections(P.id, ids);
    saved();
  } catch(err) {
    console.error('Reorder save failed:', err);
    showToast('Reorder save failed', 'error');
  }
}

// ═══ Auto-save queue ═══
function qSave(id,fields){saveQ.set(id,Object.assign(saveQ.get(id)||{},fields));saving();clearTimeout(saveTmr);saveTmr=setTimeout(flushQ,2000);}
async function flushQ(){
  var failed=0;
  for(var pair of saveQ){try{await updateSection(pair[0],pair[1]);var s=secs.find(function(x){return x.id===pair[0];});if(s)Object.assign(s,pair[1]);}catch(e){failed++;console.error('Save failed for section:',pair[0],e);}}
  saveQ.clear();
  if(failed){offlineSaved();showToast(failed+' save(s) failed — will retry','error');}else{saved();}
}
function saved(){var el=document.getElementById('saveInd');el.textContent='Saved ✓';el.className='save-ind show';setTimeout(function(){el.classList.remove('show');},2000);}
function saving(){var el=document.getElementById('saveInd');el.textContent='Saving...';el.className='save-ind show';}
function offlineSaved(){var el=document.getElementById('saveInd');el.textContent='Offline';el.className='save-ind show offline';}

// ═══ PDF Export ═══
function exportPDF(){
  if (!P.share_token) {
    var token = crypto.randomUUID();
    updateProposal(P.id, {share_token: token}).then(function(){
      P.share_token = token;
      doExportPDF();
    }).catch(function(){ showToast('Failed to generate export link','error'); });
  } else {
    doExportPDF();
  }
}

function doExportPDF(){
  showToast('Opening proposal for PDF export...','success');
  window.open('proposal-view.html?token=' + P.share_token + '&autoexport=1', '_blank');
}

async function generateShareLink(){
  try{var t=P.share_token;if(!t){t=crypto.randomUUID();await updateProposal(P.id,{share_token:t});P.share_token=t;}
  await navigator.clipboard.writeText(location.origin+'/proposal-view.html?token='+t);showToast('Share link copied!','success');}catch(e){showToast('Failed','error');}
}

// ═══ Gaby Fill ═══
async function gabyFillSection(id) {
  var s = secs.find(function(x){return x.id===id;});
  if (!s) return;
  var msg = 'GABY FILL: Please generate compelling, professional content for the "' + (s.title||'Untitled') + '" section (type: ' + s.content_type + '). This is for the proposal "' + (P.title||'') + '" for client "' + (P.client_name||'') + '". Make it design-agency quality with real data and persuasive copy.';
  try {
    var cr = await createChangeRequest(id, P.id, msg, 'Yousra');
    crs.push(cr); s.status = 'change_requested';
    renderAll(); showToast('Sent to Gaby — she will fill this section', 'success');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
}

async function gabyFillAll() {
  var empties = secs.filter(isSectionEmpty);
  if (!empties.length) { showToast('All sections already have content', 'success'); return; }
  if (!confirm('Send ' + empties.length + ' section(s) to Gaby for content generation?')) return;
  var sent = 0;
  for (var i = 0; i < empties.length; i++) {
    var s = empties[i];
    var msg = 'GABY FILL: Please generate compelling, professional content for the "' + (s.title||'Untitled') + '" section (type: ' + s.content_type + '). This is for the proposal "' + (P.title||'') + '" for client "' + (P.client_name||'') + '". Make it design-agency quality.';
    try {
      var cr = await createChangeRequest(s.id, P.id, msg, 'Yousra');
      crs.push(cr); s.status = 'change_requested'; sent++;
    } catch(e) { console.error('Failed to send CR for section:', s.title, e); }
  }
  renderAll();
  showToast(sent + ' section(s) sent to Gaby for filling', 'success');
}

// ═══ Toast ═══
function showToast(m,t){var el=document.getElementById('toast');el.textContent=m;el.className='toast '+(t||'success')+' show';setTimeout(function(){el.classList.remove('show');},3000);}

// ═══ Keyboard Shortcuts (N6) ═══
document.addEventListener('keydown', function(e) {
  // Cmd/Ctrl+S — force save
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    clearTimeout(saveTmr);
    flushQ();
  }
  // Escape — close side panel
  if (e.key === 'Escape') {
    var panel = document.getElementById('sidePanel');
    if (panel && panel.classList.contains('open')) { closePanel(); return; }
    var modal = document.getElementById('addModal');
    if (modal && modal.classList.contains('open')) { closeAddModal(); return; }
  }
  // Cmd/Ctrl+Shift+A — open add section modal
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'a') {
    e.preventDefault();
    openAddModal();
  }
});

// ═══ Init ═══
load();
