const { writeFileSync, readFileSync, existsSync } = require('fs');
const path = require('path');

// Load .env if it exists (no external dependencies needed)
const envPath = path.join(__dirname, '.env');
const env = {};
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
  console.log('Loaded config from .env');
} else {
  console.log('No .env found — using placeholders. Copy .env.example to .env and fill in your values.');
}

let idCounter = 0;
const uid = () => {
  idCounter++;
  const hex = idCounter.toString(16).padStart(4, '0');
  return `a0b1c2d3-e4f5-6789-abcd-${hex}00000000`.slice(0, 36);
};

// ============================================================
// SHARED CONFIG READER — uses helpers.httpRequest (not fetch)
// ============================================================
const READ_CONFIG = `
var CONFIG = $getWorkflowStaticData('global');
if (!CONFIG.github_token || CONFIG.github_token === 'ghp_YOUR_GITHUB_TOKEN') {
  throw new Error('Config not set! Run the manual trigger on the Save Config node first.');
}
var SELF_ID = $workflow.id;

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

async function ghRequest(path, method, body) {
  var url = path.startsWith('http') ? path : 'https://api.github.com' + path;
  var opts = {
    url: url,
    method: method || 'GET',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.github_token,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'n8n-github-sync'
    },
    returnFullResponse: true,
    ignoreHttpStatusErrors: true
  };
  if (body) {
    opts.body = body;
    opts.headers['Content-Type'] = 'application/json';
  }
  var res = await helpers.httpRequest(opts);
  var data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: data };
}

async function n8nRequest(path, method, body) {
  var opts = {
    url: CONFIG.n8n_base_url + path,
    method: method || 'GET',
    headers: {
      'X-N8N-API-KEY': CONFIG.n8n_api_key,
      'Content-Type': 'application/json'
    },
    returnFullResponse: true,
    ignoreHttpStatusErrors: true
  };
  if (body) opts.body = body;
  var res = await helpers.httpRequest(opts);
  var data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: data };
}
`.trim();

// ============================================================
// CONFIG NODE
// ============================================================
const configCode = `
var staticData = $getWorkflowStaticData('global');

staticData.github_owner   = 'YOUR_GITHUB_USERNAME';
staticData.github_repo    = 'n8n-workflows-backup';
staticData.github_branch  = 'main';
staticData.github_token   = 'ghp_YOUR_GITHUB_TOKEN';
staticData.n8n_base_url   = 'http://localhost:5678';
staticData.n8n_api_key    = 'YOUR_N8N_API_KEY';
staticData.base_path      = 'workflows';

return [{
  json: {
    message: 'Config saved!',
    config: {
      github_owner: staticData.github_owner,
      github_repo: staticData.github_repo,
      n8n_base_url: staticData.n8n_base_url,
      base_path: staticData.base_path
    }
  }
}];
`.trim();

// ============================================================
// DASHBOARD HTML — base64 encoded
// ============================================================
// Dashboard HTML — built inline and base64-encoded into the workflow

const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>n8n GitHub Sync Dashboard</title>
<style>
:root {
  --bg0: #ffffff; --bg1: #f6f8fa; --bg2: #e8eaed;
  --border: #d0d7de; --tx1: #1f2328; --tx2: #656d76;
  --accent: #0969da; --green: #1a7f37; --yellow: #9a6700; --red: #cf222e;
  --overlay: rgba(0,0,0,0.3); --hover-row: rgba(246,248,250,0.5);
  --badge-synced-bg: rgba(26,127,55,0.1); --badge-n8n-bg: rgba(154,103,0,0.1); --badge-git-bg: rgba(207,34,46,0.1);
  --toast-shadow: rgba(0,0,0,0.15); --btn-primary-bg: #1f883d; --btn-primary-hover: #1a7f37;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg0: #0d1117; --bg1: #161b22; --bg2: #21262d;
    --border: #30363d; --tx1: #c9d1d9; --tx2: #8b949e;
    --accent: #58a6ff; --green: #3fb950; --yellow: #d29922; --red: #f85149;
    --overlay: rgba(0,0,0,0.6); --hover-row: rgba(22,27,34,0.5);
    --badge-synced-bg: rgba(63,185,80,0.15); --badge-n8n-bg: rgba(210,153,34,0.15); --badge-git-bg: rgba(248,81,73,0.15);
    --toast-shadow: rgba(0,0,0,0.4); --btn-primary-bg: #238636; --btn-primary-hover: #2ea043;
  }
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg0); color: var(--tx1); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Noto Sans, Helvetica, Arial, sans-serif; line-height: 1.5; }
.container { max-width: 1280px; margin: 0 auto; padding: 24px; }
.header { margin-bottom: 24px; }
.header h1 { font-size: 24px; font-weight: 600; }
.header p { color: var(--tx2); font-size: 14px; margin-top: 2px; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-card { background: var(--bg1); border: 1px solid var(--border); border-radius: 6px; padding: 16px; transition: border-color 0.2s; }
.stat-card:hover { border-color: var(--tx2); }
.stat-card .label { font-size: 12px; color: var(--tx2); text-transform: uppercase; letter-spacing: 0.5px; }
.stat-card .value { font-size: 28px; font-weight: 600; margin-top: 4px; }
.stat-card.total .value { color: var(--accent); }
.stat-card.synced .value { color: var(--green); }
.stat-card.n8n-only .value { color: var(--yellow); }
.stat-card.git-only .value { color: var(--red); }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
.toolbar-actions { display: flex; gap: 8px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 16px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg1); color: var(--tx1); cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.15s; text-decoration: none; white-space: nowrap; }
.btn:hover { background: var(--bg2); border-color: var(--tx2); }
.btn-primary { background: var(--btn-primary-bg); border-color: rgba(240,246,252,0.1); color: #fff; }
.btn-primary:hover { background: var(--btn-primary-hover); }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tabs { display: flex; }
.tab { padding: 6px 16px; border: 1px solid var(--border); background: var(--bg0); color: var(--tx2); cursor: pointer; font-size: 14px; border-right: none; transition: all 0.15s; }
.tab:first-child { border-radius: 6px 0 0 6px; }
.tab:last-child { border-radius: 0 6px 6px 0; border-right: 1px solid var(--border); }
.tab.active { background: var(--bg1); color: var(--tx1); }
.tab:hover { color: var(--tx1); }
.table-container { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
thead { background: var(--bg1); }
th { padding: 12px 16px; text-align: left; font-size: 12px; color: var(--tx2); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
td { padding: 12px 16px; border-top: 1px solid var(--border); font-size: 14px; }
tr:hover { background: var(--hover-row); }
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; }
.badge-synced { background: var(--badge-synced-bg); color: var(--green); }
.badge-n8n-only { background: var(--badge-n8n-bg); color: var(--yellow); }
.badge-git-only { background: var(--badge-git-bg); color: var(--red); }
.modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: var(--overlay); z-index: 100; justify-content: center; align-items: center; }
.modal-overlay.active { display: flex; }
.modal { background: var(--bg1); border: 1px solid var(--border); border-radius: 12px; width: 90%; max-width: 560px; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; }
.modal-wide { max-width: 640px; }
.modal-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
.modal-header h3 { font-size: 16px; font-weight: 600; }
.modal-close { background: none; border: none; color: var(--tx2); cursor: pointer; font-size: 20px; padding: 4px 8px; }
.modal-close:hover { color: var(--tx1); }
.modal-body { padding: 20px; overflow-y: auto; flex: 1; }
.modal-footer { padding: 16px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }
input[type="text"], textarea, select { width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg0); color: var(--tx1); font-size: 14px; font-family: inherit; }
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent); }
textarea { resize: vertical; min-height: 80px; }
label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
.form-group { margin-bottom: 16px; }
.commit-list { list-style: none; }
.commit-item { padding: 12px 0; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.commit-item:last-child { border-bottom: none; }
.commit-info { flex: 1; min-width: 0; }
.commit-sha { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; color: var(--accent); }
.commit-msg { font-size: 14px; margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.commit-meta { font-size: 12px; color: var(--tx2); }
.radio-group { display: flex; flex-direction: column; gap: 8px; }
.radio-option { display: flex; align-items: center; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; transition: border-color 0.15s; }
.radio-option:hover { border-color: var(--accent); }
.radio-option input { accent-color: var(--accent); }
.toast-container { position: fixed; top: 20px; right: 20px; z-index: 200; display: flex; flex-direction: column; gap: 8px; }
.toast { padding: 12px 20px; border-radius: 6px; font-size: 14px; animation: slideIn 0.3s ease; min-width: 280px; border: 1px solid var(--border); box-shadow: 0 4px 12px var(--toast-shadow); }
.toast-success { background: var(--badge-synced-bg); color: var(--green); border-color: var(--green); }
.toast-error { background: var(--badge-git-bg); color: var(--red); border-color: var(--red); }
.toast-info { background: rgba(88,166,255,0.15); color: var(--accent); border-color: var(--accent); }
@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
.loading { text-align: center; padding: 40px; color: var(--tx2); }
.spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; margin-right: 8px; }
@keyframes spin { to { transform: rotate(360deg); } }
.empty { text-align: center; padding: 40px; color: var(--tx2); }
code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; background: var(--bg2); padding: 2px 6px; border-radius: 4px; }
.actions-cell { display: flex; gap: 4px; }
@media (max-width: 768px) { .stats { grid-template-columns: repeat(2, 1fr); } .toolbar { flex-direction: column; align-items: stretch; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>&#128260; n8n &#8596; GitHub Sync</h1>
    <p>Manage and synchronize your n8n workflows with GitHub</p>
  </div>
  <div class="stats">
    <div class="stat-card total"><div class="label">Total Workflows</div><div class="value" id="stat-total">&#8212;</div></div>
    <div class="stat-card synced"><div class="label">Synced</div><div class="value" id="stat-synced">&#8212;</div></div>
    <div class="stat-card n8n-only"><div class="label">n8n Only</div><div class="value" id="stat-n8n">&#8212;</div></div>
    <div class="stat-card git-only"><div class="label">GitHub Only</div><div class="value" id="stat-git">&#8212;</div></div>
  </div>
  <div class="toolbar">
    <div class="toolbar-actions">
      <button class="btn btn-primary" id="sync-all-btn" data-action="sync-all">&#11014;&#65039; Sync All to GitHub</button>
      <button class="btn" data-action="refresh">&#128260; Refresh</button>
    </div>
    <div class="tabs" id="filter-tabs">
      <div class="tab active" data-filter="all">All</div>
      <div class="tab" data-filter="synced">Synced</div>
      <div class="tab" data-filter="n8n-only">n8n Only</div>
      <div class="tab" data-filter="git-only">GitHub Only</div>
    </div>
  </div>
  <div class="table-container">
    <table>
      <thead><tr><th>Workflow</th><th>ID</th><th>Status</th><th>Active</th><th>Last Modified</th><th>Actions</th></tr></thead>
      <tbody id="workflow-table"><tr><td colspan="6" class="loading"><span class="spinner"></span> Loading workflows...</td></tr></tbody>
    </table>
  </div>
</div>
<div class="modal-overlay" id="push-modal"><div class="modal">
  <div class="modal-header"><h3>&#11014;&#65039; Push to GitHub</h3><button class="modal-close" data-action="close-modal" data-modal="push-modal">&#10005;</button></div>
  <div class="modal-body">
    <div class="form-group"><label>Workflow</label><input type="text" id="push-wf-name" readonly></div>
    <div class="form-group"><label>Commit Message</label><textarea id="push-commit-msg" placeholder="Describe your changes..."></textarea></div>
  </div>
  <div class="modal-footer"><button class="btn" data-action="close-modal" data-modal="push-modal">Cancel</button><button class="btn btn-primary" id="push-confirm-btn" data-action="confirm-push">Push</button></div>
</div></div>
<div class="modal-overlay" id="history-modal"><div class="modal modal-wide">
  <div class="modal-header"><h3>&#128220; Commit History</h3><button class="modal-close" data-action="close-modal" data-modal="history-modal">&#10005;</button></div>
  <div class="modal-body"><div id="history-content"><div class="loading"><span class="spinner"></span> Loading...</div></div></div>
</div></div>
<div class="modal-overlay" id="restore-modal"><div class="modal">
  <div class="modal-header"><h3>&#11015;&#65039; Restore from GitHub</h3><button class="modal-close" data-action="close-modal" data-modal="restore-modal">&#10005;</button></div>
  <div class="modal-body">
    <div class="form-group"><label>Workflow</label><input type="text" id="restore-wf-name" readonly></div>
    <div class="form-group"><label>Import Mode</label>
      <div class="radio-group">
        <label class="radio-option"><input type="radio" name="restore-mode" value="new" checked> Import as new workflow</label>
        <label class="radio-option"><input type="radio" name="restore-mode" value="replace"> Replace existing workflow</label>
      </div>
    </div>
    <div class="form-group" id="restore-target-group" style="display:none"><label>Target Workflow ID</label><input type="text" id="restore-target-id" placeholder="Workflow ID to replace"></div>
    <div class="form-group"><label>Version</label><select id="restore-commit"><option value="">Latest version</option></select></div>
  </div>
  <div class="modal-footer"><button class="btn" data-action="close-modal" data-modal="restore-modal">Cancel</button><button class="btn btn-primary" data-action="confirm-restore">Restore</button></div>
</div></div>
<div class="toast-container" id="toast-container"></div>
<script>
(function() {
  var API_BASE = '__API_BASE__';
  var workflows = [];
  var currentFilter = 'all';
  var pushWorkflowId = '';

  fetchStatus();

  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-action]');
    if (!el) {
      var overlay = e.target.closest('.modal-overlay');
      if (overlay && e.target === overlay) overlay.classList.remove('active');
      var tab = e.target.closest('[data-filter]');
      if (tab) {
        currentFilter = tab.getAttribute('data-filter');
        var tabs = document.querySelectorAll('.tab');
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
        tab.classList.add('active');
        renderTable();
      }
      return;
    }
    var a = el.getAttribute('data-action');
    if (a === 'sync-all') syncAll();
    else if (a === 'refresh') fetchStatus();
    else if (a === 'close-modal') document.getElementById(el.getAttribute('data-modal')).classList.remove('active');
    else if (a === 'confirm-push') confirmPush();
    else if (a === 'confirm-restore') confirmRestore();
    else if (a === 'push') showPush(el.getAttribute('data-id'), el.getAttribute('data-name'));
    else if (a === 'history') showHist(el.getAttribute('data-path'), el.getAttribute('data-name'));
    else if (a === 'restore') showRestore(el.getAttribute('data-path'), el.getAttribute('data-name'), el.getAttribute('data-id') || '');
    else if (a === 'restore-commit') {
      document.getElementById('history-modal').classList.remove('active');
      showRestore(el.getAttribute('data-path'), '', '');
      var sha = el.getAttribute('data-sha');
      setTimeout(function() { var s = document.getElementById('restore-commit'); for (var i = 0; i < s.options.length; i++) { if (s.options[i].value === sha) { s.selectedIndex = i; break; } } }, 800);
    }
  });

  document.addEventListener('change', function(e) {
    if (e.target.name === 'restore-mode') document.getElementById('restore-target-group').style.display = e.target.value === 'replace' ? 'block' : 'none';
  });

  function fetchStatus() {
    var tbody = document.getElementById('workflow-table');
    tbody.innerHTML = '<tr><td colspan="6" class="loading"><span class="spinner"></span> Loading...</td></tr>';
    apiGet('/api/status', function(data) {
      if (data.error) { toast(data.error, 'error'); return; }
      workflows = data.workflows || [];
      renderStats(); renderTable();
    }, function(err) {
      toast('Failed to load: ' + err, 'error');
      tbody.innerHTML = '<tr><td colspan="6" class="empty">Failed to load. Check Config node.</td></tr>';
    });
  }

  function syncAll() {
    var btn = document.getElementById('sync-all-btn');
    btn.disabled = true; btn.textContent = '\u23F3 Syncing...';
    apiPost('/api/sync-all', {}, function(d) {
      if (d.error) toast(d.error, 'error');
      else { toast('Synced ' + (d.synced||0) + ' workflows (' + (d.created||0) + ' new, ' + (d.updated||0) + ' updated)', 'success'); fetchStatus(); }
    }, function(err) { toast('Sync failed: ' + err, 'error'); },
    function() { btn.disabled = false; btn.innerHTML = '&#11014;&#65039; Sync All to GitHub'; });
  }

  function showPush(id, name) {
    pushWorkflowId = id;
    document.getElementById('push-wf-name').value = name;
    document.getElementById('push-commit-msg').value = 'Update: ' + name;
    document.getElementById('push-modal').classList.add('active');
    setTimeout(function() { document.getElementById('push-commit-msg').focus(); }, 100);
  }

  function confirmPush() {
    var msg = document.getElementById('push-commit-msg').value;
    document.getElementById('push-modal').classList.remove('active');
    toast('Pushing...', 'info');
    apiPost('/api/sync-single', { workflow_id: pushWorkflowId, commit_message: msg }, function(d) {
      if (d.error) toast(d.error, 'error');
      else { toast(d.message || 'Pushed!', 'success'); fetchStatus(); }
    }, function(err) { toast('Push failed: ' + err, 'error'); });
  }

  function showHist(path, name) {
    var el = document.getElementById('history-content');
    el.innerHTML = '<div class="loading"><span class="spinner"></span> Loading...</div>';
    document.getElementById('history-modal').classList.add('active');
    apiPost('/api/history', { github_path: path }, function(d) {
      var commits = d.commits || [];
      if (!commits.length) { el.innerHTML = '<div class="empty">No commits found</div>'; return; }
      var h = '<ul class="commit-list">';
      for (var i = 0; i < commits.length; i++) {
        var c = commits[i];
        h += '<li class="commit-item"><div class="commit-info"><div class="commit-sha">' + esc(c.sha.substring(0,7)) + '</div><div class="commit-msg">' + esc(c.message) + '</div><div class="commit-meta">' + esc(c.author) + ' \u00B7 ' + new Date(c.date).toLocaleString() + '</div></div><button class="btn btn-sm" data-action="restore-commit" data-path="' + attr(path) + '" data-sha="' + attr(c.sha) + '">Restore</button></li>';
      }
      el.innerHTML = h + '</ul>';
    }, function(err) { el.innerHTML = '<div class="empty">Error: ' + esc(err) + '</div>'; });
  }

  function showRestore(path, name, existingId) {
    var modal = document.getElementById('restore-modal');
    modal.setAttribute('data-path', path);
    modal.setAttribute('data-existing-id', existingId || '');
    document.getElementById('restore-wf-name').value = name || path.split('/').pop().replace('.json','');
    document.getElementById('restore-target-id').value = existingId || '';
    document.getElementById('restore-target-group').style.display = 'none';
    var radios = document.querySelectorAll('input[name="restore-mode"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === 'new';
    var sel = document.getElementById('restore-commit');
    sel.innerHTML = '<option value="">Latest version</option>';
    if (path) apiPost('/api/history', { github_path: path }, function(d) {
      var commits = d.commits || [];
      for (var i = 0; i < commits.length; i++) { var o = document.createElement('option'); o.value = commits[i].sha; o.textContent = commits[i].sha.substring(0,7) + ' - ' + commits[i].message; sel.appendChild(o); }
    });
    modal.classList.add('active');
  }

  function confirmRestore() {
    var modal = document.getElementById('restore-modal');
    var path = modal.getAttribute('data-path');
    var existingId = modal.getAttribute('data-existing-id');
    var modeEl = document.querySelector('input[name="restore-mode"]:checked');
    var mode = modeEl ? modeEl.value : 'new';
    var targetId = document.getElementById('restore-target-id').value || existingId;
    var sha = document.getElementById('restore-commit').value;
    modal.classList.remove('active');
    toast('Restoring...', 'info');
    var body = { github_path: path, mode: mode };
    if (sha) body.commit_sha = sha;
    if (mode === 'replace' && targetId) body.target_workflow_id = targetId;
    apiPost('/api/restore', body, function(d) {
      if (d.error) toast(d.error, 'error');
      else { toast(d.message || 'Restored!', 'success'); fetchStatus(); }
    }, function(err) { toast('Restore failed: ' + err, 'error'); });
  }

  function renderStats() {
    var s = 0, n = 0, g = 0;
    for (var i = 0; i < workflows.length; i++) { if (workflows[i].status === 'synced') s++; else if (workflows[i].status === 'n8n-only') n++; else if (workflows[i].status === 'git-only') g++; }
    document.getElementById('stat-total').textContent = workflows.length;
    document.getElementById('stat-synced').textContent = s;
    document.getElementById('stat-n8n').textContent = n;
    document.getElementById('stat-git').textContent = g;
  }

  function renderTable() {
    var tbody = document.getElementById('workflow-table');
    var f = [];
    for (var i = 0; i < workflows.length; i++) { if (currentFilter === 'all' || workflows[i].status === currentFilter) f.push(workflows[i]); }
    if (!f.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No workflows match</td></tr>'; return; }
    var rows = '';
    for (var i = 0; i < f.length; i++) {
      var w = f[i];
      var badge = '<span class="badge badge-' + w.status + '">' + w.status.replace('-',' ') + '</span>';
      var active = w.active ? '\u2705' : '\u23F8\uFE0F';
      var mod = w.updatedAt ? new Date(w.updatedAt).toLocaleString() : '\u2014';
      var acts = '<div class="actions-cell">';
      if (w.status !== 'git-only') acts += '<button class="btn btn-sm" data-action="push" data-id="' + attr(w.id) + '" data-name="' + attr(w.name) + '" title="Push">\u2B06\uFE0F</button>';
      if (w.github_path) {
        acts += '<button class="btn btn-sm" data-action="history" data-path="' + attr(w.github_path) + '" data-name="' + attr(w.name) + '" title="History">\uD83D\uDCDC</button>';
        if (w.github_url) acts += '<a class="btn btn-sm" href="' + attr(w.github_url) + '" target="_blank" title="GitHub">\uD83D\uDD17</a>';
      }
      if (w.status === 'git-only' || w.github_path) acts += '<button class="btn btn-sm" data-action="restore" data-path="' + attr(w.github_path||'') + '" data-name="' + attr(w.name) + '" data-id="' + attr(w.id||'') + '" title="Restore">\u2B07\uFE0F</button>';
      acts += '</div>';
      rows += '<tr><td><strong>' + esc(w.name) + '</strong></td><td><code>' + (w.id||'\u2014') + '</code></td><td>' + badge + '</td><td style="text-align:center">' + active + '</td><td>' + mod + '</td><td>' + acts + '</td></tr>';
    }
    tbody.innerHTML = rows;
  }

  function toast(msg, type) { var c = document.getElementById('toast-container'); var t = document.createElement('div'); t.className = 'toast toast-' + type; t.textContent = msg; c.appendChild(t); setTimeout(function() { if (t.parentNode) t.remove(); }, 4000); }
  function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }
  function attr(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

  function apiGet(path, ok, err) {
    var x = new XMLHttpRequest();
    x.open('GET', API_BASE + path, true);
    x.onload = function() { try { ok(JSON.parse(x.responseText)); } catch(e) { if (err) err(e.message); } };
    x.onerror = function() { if (err) err('Network error'); };
    x.send();
  }
  function apiPost(path, body, ok, err, done) {
    var x = new XMLHttpRequest();
    x.open('POST', API_BASE + path, true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function() { try { ok(JSON.parse(x.responseText)); } catch(e) { if (err) err(e.message); } if (done) done(); };
    x.onerror = function() { if (err) err('Network error'); if (done) done(); };
    x.send(JSON.stringify(body));
  }
})();
</script>
</body>
</html>`;

const htmlBase64 = Buffer.from(dashboardHtml).toString('base64');

const dashboardCode = [
  '// Dashboard: open in a NEW browser tab at the full webhook URL.',
  '// Do NOT use n8n built-in webhook preview (sandboxed iframe).',
  'var items = $input.all();',
  'var headers = items[0].json.headers || {};',
  "var proto = headers['x-forwarded-proto'] || headers['x-forwarded-scheme'] || 'http';",
  "var host = headers['host'] || 'localhost:5678';",
  "var apiBase = proto + '://' + host + '/webhook/github-sync';",
  '',
  "var html = Buffer.from('" + htmlBase64 + "', 'base64').toString('utf8');",
  "html = html.split('__API_BASE__').join(apiBase);",
  '',
  'return [{ json: { html: html } }];'
].join('\n');

// ============================================================
// STATUS API — uses helpers.httpRequest
// ============================================================
const statusCode = `
${READ_CONFIG}

var n8nRes = await n8nRequest('/api/v1/workflows');
var n8nWorkflows = (n8nRes.data.data || n8nRes.data).filter(function(w) { return w.id !== SELF_ID; });

var ghFiles = [];
try {
  var ghRes = await ghRequest('/repos/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/contents/' + CONFIG.base_path + '?ref=' + CONFIG.github_branch);
  if (ghRes.ok && Array.isArray(ghRes.data)) ghFiles = ghRes.data;
} catch (e) {}

var ghMap = {};
for (var i = 0; i < ghFiles.length; i++) {
  var match = ghFiles[i].name.match(/^([^_]+)_/);
  if (match) ghMap[match[1]] = { path: ghFiles[i].path, sha: ghFiles[i].sha, name: ghFiles[i].name };
}

var workflows = [];
var n8nIds = {};

for (var i = 0; i < n8nWorkflows.length; i++) {
  var wf = n8nWorkflows[i];
  n8nIds[wf.id] = true;
  var gh = ghMap[wf.id];
  workflows.push({
    id: wf.id, name: wf.name,
    status: gh ? 'synced' : 'n8n-only',
    active: wf.active || false,
    github_path: gh ? gh.path : null,
    github_url: gh ? 'https://github.com/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/blob/' + CONFIG.github_branch + '/' + gh.path : null,
    last_synced: null, updatedAt: wf.updatedAt
  });
}

var ghKeys = Object.keys(ghMap);
for (var i = 0; i < ghKeys.length; i++) {
  if (!n8nIds[ghKeys[i]]) {
    var g = ghMap[ghKeys[i]];
    workflows.push({
      id: null, name: g.name.replace(/^[^_]+_/, '').replace(/\\.json$/, '').replace(/_/g, ' '),
      status: 'git-only', active: false,
      github_path: g.path,
      github_url: 'https://github.com/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/blob/' + CONFIG.github_branch + '/' + g.path,
      last_synced: null, updatedAt: null
    });
  }
}

var order = { 'n8n-only': 0, 'synced': 1, 'git-only': 2 };
workflows.sort(function(a, b) { return (order[a.status] || 9) - (order[b.status] || 9); });

return [{ json: { workflows: workflows } }];
`.trim();

// ============================================================
// SYNC ALL
// ============================================================
const syncAllCode = `
${READ_CONFIG}

var body = $input.first().json.body || {};
var customMsg = body.commit_message || null;

var n8nRes = await n8nRequest('/api/v1/workflows');
var allWorkflows = (n8nRes.data.data || n8nRes.data).filter(function(w) { return w.id !== SELF_ID; });

var ghMap = {};
try {
  var ghRes = await ghRequest('/repos/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/contents/' + CONFIG.base_path + '?ref=' + CONFIG.github_branch);
  if (ghRes.ok && Array.isArray(ghRes.data)) {
    for (var i = 0; i < ghRes.data.length; i++) {
      var m = ghRes.data[i].name.match(/^([^_]+)_/);
      if (m) ghMap[m[1]] = ghRes.data[i].sha;
    }
  }
} catch (e) {}

var created = 0, updated = 0, errors = [];

for (var i = 0; i < allWorkflows.length; i++) {
  var wf = allWorkflows[i];
  try {
    var fullRes = await n8nRequest('/api/v1/workflows/' + wf.id);
    var fullWf = fullRes.data;
    var fileName = wf.id + '_' + sanitizeName(wf.name) + '.json';
    var filePath = CONFIG.base_path + '/' + fileName;
    var content = Buffer.from(JSON.stringify(fullWf, null, 2)).toString('base64');
    var existingSha = ghMap[wf.id];

    var putBody = { message: customMsg || 'Sync: ' + wf.name, content: content, branch: CONFIG.github_branch };
    if (existingSha) putBody.sha = existingSha;

    var putRes = await ghRequest('/repos/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/contents/' + filePath, 'PUT', JSON.stringify(putBody));
    if (putRes.ok) { if (existingSha) updated++; else created++; }
    else { errors.push({ id: wf.id, name: wf.name, error: (putRes.data && putRes.data.message) || 'HTTP ' + putRes.status }); }
  } catch (e) { errors.push({ id: wf.id, name: wf.name, error: e.message }); }
}

return [{ json: { synced: created + updated, created: created, updated: updated, errors: errors } }];
`.trim();

// ============================================================
// SYNC SINGLE
// ============================================================
const syncSingleCode = `
${READ_CONFIG}

var body = $input.first().json.body || {};
var workflowId = body.workflow_id;
var commitMsg = body.commit_message || 'Sync workflow';

if (!workflowId) return [{ json: { error: 'workflow_id is required' } }];

var fullRes = await n8nRequest('/api/v1/workflows/' + workflowId);
if (!fullRes.ok) return [{ json: { error: 'Workflow not found' } }];

var fullWf = fullRes.data;
var fileName = workflowId + '_' + sanitizeName(fullWf.name) + '.json';
var filePath = CONFIG.base_path + '/' + fileName;
var content = Buffer.from(JSON.stringify(fullWf, null, 2)).toString('base64');

var existingSha = null;
try {
  var checkRes = await ghRequest('/repos/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/contents/' + filePath + '?ref=' + CONFIG.github_branch);
  if (checkRes.ok) existingSha = checkRes.data.sha;
} catch (e) {}

var putBody = { message: commitMsg, content: content, branch: CONFIG.github_branch };
if (existingSha) putBody.sha = existingSha;

var putRes = await ghRequest('/repos/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/contents/' + filePath, 'PUT', JSON.stringify(putBody));
if (!putRes.ok) return [{ json: { error: (putRes.data && putRes.data.message) || 'Push failed' } }];

return [{ json: { message: 'Synced successfully (' + (existingSha ? 'updated' : 'created') + ')', action: existingSha ? 'updated' : 'created' } }];
`.trim();

// ============================================================
// HISTORY
// ============================================================
const historyCode = `
${READ_CONFIG}

var body = $input.first().json.body || {};
var githubPath = body.github_path;
if (!githubPath) return [{ json: { error: 'github_path is required', commits: [] } }];

var res = await ghRequest('/repos/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/commits?path=' + encodeURIComponent(githubPath) + '&sha=' + CONFIG.github_branch);
if (!res.ok) return [{ json: { error: 'Failed to fetch history', commits: [] } }];

var commits = [];
for (var i = 0; i < res.data.length; i++) {
  var c = res.data[i];
  commits.push({
    sha: c.sha, message: c.commit.message, date: c.commit.author.date,
    author: c.commit.author.name || (c.author && c.author.login) || 'unknown'
  });
}
return [{ json: { commits: commits } }];
`.trim();

// ============================================================
// RESTORE
// ============================================================
const restoreCode = `
${READ_CONFIG}

var body = $input.first().json.body || {};
if (!body.github_path) return [{ json: { error: 'github_path is required' } }];

var url = '/repos/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/contents/' + body.github_path + '?ref=' + (body.commit_sha || CONFIG.github_branch);
var ghRes = await ghRequest(url);
if (!ghRes.ok) return [{ json: { error: 'File not found on GitHub' } }];

var workflowJson;
try { workflowJson = JSON.parse(Buffer.from(ghRes.data.content, 'base64').toString('utf8')); }
catch (e) { return [{ json: { error: 'Invalid JSON in GitHub file' } }]; }

delete workflowJson.id;
delete workflowJson.createdAt;
delete workflowJson.updatedAt;

if (body.mode === 'replace' && body.target_workflow_id) {
  var r = await n8nRequest('/api/v1/workflows/' + body.target_workflow_id, 'PUT', JSON.stringify(workflowJson));
  if (!r.ok) return [{ json: { error: (r.data && r.data.message) || 'Update failed' } }];
  return [{ json: { message: 'Workflow replaced successfully', workflow_id: body.target_workflow_id } }];
} else {
  workflowJson.name = (workflowJson.name || 'Restored') + ' (restored)';
  var r = await n8nRequest('/api/v1/workflows', 'POST', JSON.stringify(workflowJson));
  if (!r.ok) return [{ json: { error: (r.data && r.data.message) || 'Create failed' } }];
  return [{ json: { message: 'Workflow imported successfully', workflow_id: r.data.id } }];
}
`.trim();

// ============================================================
// SCHEDULED SYNC
// ============================================================
const scheduledSyncCode = `
${READ_CONFIG}

var n8nRes = await n8nRequest('/api/v1/workflows');
var allWorkflows = (n8nRes.data.data || n8nRes.data).filter(function(w) { return w.id !== SELF_ID; });

// Fetch existing GitHub files with their download URLs
var ghMap = {};
try {
  var ghRes = await ghRequest('/repos/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/contents/' + CONFIG.base_path + '?ref=' + CONFIG.github_branch);
  if (ghRes.ok && Array.isArray(ghRes.data)) {
    for (var i = 0; i < ghRes.data.length; i++) {
      var m = ghRes.data[i].name.match(/^([^_]+)_/);
      if (m) ghMap[m[1]] = { sha: ghRes.data[i].sha, path: ghRes.data[i].path, download_url: ghRes.data[i].download_url };
    }
  }
} catch (e) {}

function describeChanges(oldWf, newWf) {
  var changes = [];
  var oldNodes = (oldWf.nodes || []).map(function(n) { return n.name; });
  var newNodes = (newWf.nodes || []).map(function(n) { return n.name; });
  var added = newNodes.filter(function(n) { return oldNodes.indexOf(n) === -1; });
  var removed = oldNodes.filter(function(n) { return newNodes.indexOf(n) === -1; });
  if (added.length) changes.push('Added: ' + added.join(', '));
  if (removed.length) changes.push('Removed: ' + removed.join(', '));
  var modified = [];
  for (var i = 0; i < newWf.nodes.length; i++) {
    var nn = newWf.nodes[i];
    for (var j = 0; j < oldWf.nodes.length; j++) {
      var on = oldWf.nodes[j];
      if (nn.name === on.name && JSON.stringify(nn.parameters) !== JSON.stringify(on.parameters)) {
        modified.push(nn.name);
        break;
      }
    }
  }
  if (modified.length) changes.push('Modified: ' + modified.join(', '));
  if (newWf.nodes.length !== oldWf.nodes.length && !added.length && !removed.length) {
    changes.push('Node count: ' + oldWf.nodes.length + ' -> ' + newWf.nodes.length);
  }
  if (JSON.stringify(newWf.connections) !== JSON.stringify(oldWf.connections)) changes.push('Connections updated');
  if ((newWf.active || false) !== (oldWf.active || false)) changes.push('Active: ' + (newWf.active ? 'on' : 'off'));
  if (!changes.length) changes.push('Settings or metadata changed');
  return changes.join(' | ');
}

var created = 0, updated = 0, skipped = 0, errors = [];
var details = [];

for (var i = 0; i < allWorkflows.length; i++) {
  var wf = allWorkflows[i];
  try {
    var fullRes = await n8nRequest('/api/v1/workflows/' + wf.id);
    var fullWf = fullRes.data;
    var fileName = wf.id + '_' + sanitizeName(wf.name) + '.json';
    var filePath = CONFIG.base_path + '/' + fileName;
    var existing = ghMap[wf.id];

    // If it exists on GitHub, check if it actually changed
    if (existing) {
      var ghFileRes = await ghRequest('/repos/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/contents/' + existing.path + '?ref=' + CONFIG.github_branch);
      if (ghFileRes.ok && ghFileRes.data.content) {
        var oldWf = JSON.parse(Buffer.from(ghFileRes.data.content, 'base64').toString('utf8'));
        // Compare updatedAt — if same, skip
        if (oldWf.updatedAt && fullWf.updatedAt && oldWf.updatedAt === fullWf.updatedAt) {
          skipped++;
          continue;
        }
        // Build descriptive commit message
        var desc = describeChanges(oldWf, fullWf);
        var commitMsg = 'Update ' + wf.name + ': ' + desc;
        var content = Buffer.from(JSON.stringify(fullWf, null, 2)).toString('base64');
        var putBody = { message: commitMsg, content: content, branch: CONFIG.github_branch, sha: existing.sha };
        var putRes = await ghRequest('/repos/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/contents/' + filePath, 'PUT', JSON.stringify(putBody));
        if (putRes.ok) { updated++; details.push(commitMsg); }
        else { errors.push({ id: wf.id, name: wf.name, error: (putRes.data && putRes.data.message) || 'HTTP ' + putRes.status }); }
        continue;
      }
    }

    // New workflow — push it
    var content = Buffer.from(JSON.stringify(fullWf, null, 2)).toString('base64');
    var putBody = { message: 'Add ' + wf.name + ' (' + (fullWf.nodes || []).length + ' nodes)', content: content, branch: CONFIG.github_branch };
    if (existing) putBody.sha = existing.sha;
    var putRes = await ghRequest('/repos/' + CONFIG.github_owner + '/' + CONFIG.github_repo + '/contents/' + filePath, 'PUT', JSON.stringify(putBody));
    if (putRes.ok) { created++; details.push('Add ' + wf.name); }
    else { errors.push({ id: wf.id, name: wf.name, error: (putRes.data && putRes.data.message) || 'HTTP ' + putRes.status }); }
  } catch (e) { errors.push({ id: wf.id, name: wf.name, error: e.message }); }
}

return [{ json: { synced: created + updated, created: created, updated: updated, skipped: skipped, errors: errors, details: details, timestamp: new Date().toISOString() } }];
`.trim();

// ============================================================
// BUILD WORKFLOW
// ============================================================
const nodes = [
  { parameters: { width: 440, height: 280, content: "## \u2699\uFE0F Setup\n\n1. Open **Save Config** node, fill in values\n2. Click **Test step** (or set staticData via API)\n3. Activate workflow\n4. Open webhook URL in a **new browser tab**\n\n> Config is stored in workflow static data." },
    id: uid(), name: "Sticky Note", type: "n8n-nodes-base.stickyNote", typeVersion: 1, position: [-200, -300] },

  { parameters: {}, id: uid(), name: "Setup Trigger", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [80, -160] },
  { parameters: { jsCode: configCode, mode: "runOnceForAllItems" }, id: uid(), name: "Save Config", type: "n8n-nodes-base.code", typeVersion: 2, position: [400, -160] },

  { parameters: { path: "github-sync", httpMethod: "GET", responseMode: "responseNode", options: {} }, id: uid(), name: "Dashboard Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [80, 100], webhookId: uid() },
  { parameters: { jsCode: dashboardCode, mode: "runOnceForAllItems" }, id: uid(), name: "Generate Dashboard", type: "n8n-nodes-base.code", typeVersion: 2, position: [400, 100] },
  { parameters: { respondWith: "text", responseBody: "={{ $json.html }}", options: { responseCode: 200, responseHeaders: { entries: [{ name: "Content-Type", value: "text/html; charset=utf-8" }] } } }, id: uid(), name: "Send Dashboard", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [720, 100] },

  { parameters: { path: "github-sync/api/status", httpMethod: "GET", responseMode: "responseNode", options: {} }, id: uid(), name: "Status Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [80, 360], webhookId: uid() },
  { parameters: { jsCode: statusCode, mode: "runOnceForAllItems" }, id: uid(), name: "Get Status", type: "n8n-nodes-base.code", typeVersion: 2, position: [400, 360] },
  { parameters: { respondWith: "firstIncomingItem", options: {} }, id: uid(), name: "Send Status", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [720, 360] },

  { parameters: { path: "github-sync/api/sync-all", httpMethod: "POST", responseMode: "responseNode", options: {} }, id: uid(), name: "Sync All Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [80, 560], webhookId: uid() },
  { parameters: { jsCode: syncAllCode, mode: "runOnceForAllItems" }, id: uid(), name: "Sync All Workflows", type: "n8n-nodes-base.code", typeVersion: 2, position: [400, 560] },
  { parameters: { respondWith: "firstIncomingItem", options: {} }, id: uid(), name: "Send Sync Result", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [720, 560] },

  { parameters: { path: "github-sync/api/sync-single", httpMethod: "POST", responseMode: "responseNode", options: {} }, id: uid(), name: "Sync Single Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [80, 760], webhookId: uid() },
  { parameters: { jsCode: syncSingleCode, mode: "runOnceForAllItems" }, id: uid(), name: "Sync Single Workflow", type: "n8n-nodes-base.code", typeVersion: 2, position: [400, 760] },
  { parameters: { respondWith: "firstIncomingItem", options: {} }, id: uid(), name: "Send Single Result", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [720, 760] },

  { parameters: { path: "github-sync/api/history", httpMethod: "POST", responseMode: "responseNode", options: {} }, id: uid(), name: "History Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [80, 960], webhookId: uid() },
  { parameters: { jsCode: historyCode, mode: "runOnceForAllItems" }, id: uid(), name: "Get History", type: "n8n-nodes-base.code", typeVersion: 2, position: [400, 960] },
  { parameters: { respondWith: "firstIncomingItem", options: {} }, id: uid(), name: "Send History", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [720, 960] },

  { parameters: { path: "github-sync/api/restore", httpMethod: "POST", responseMode: "responseNode", options: {} }, id: uid(), name: "Restore Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [80, 1160], webhookId: uid() },
  { parameters: { jsCode: restoreCode, mode: "runOnceForAllItems" }, id: uid(), name: "Restore Workflow", type: "n8n-nodes-base.code", typeVersion: 2, position: [400, 1160] },
  { parameters: { respondWith: "firstIncomingItem", options: {} }, id: uid(), name: "Send Restore Result", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [720, 1160] },

  { parameters: { rule: { interval: [{ field: "hours", hoursInterval: 24 }] } }, id: uid(), name: "Schedule Trigger", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [80, 1400] },
  { parameters: { jsCode: scheduledSyncCode, mode: "runOnceForAllItems" }, id: uid(), name: "Scheduled Sync", type: "n8n-nodes-base.code", typeVersion: 2, position: [400, 1400] }
];

const connections = {
  "Setup Trigger":        { main: [[{ node: "Save Config", type: "main", index: 0 }]] },
  "Dashboard Webhook":    { main: [[{ node: "Generate Dashboard", type: "main", index: 0 }]] },
  "Generate Dashboard":   { main: [[{ node: "Send Dashboard", type: "main", index: 0 }]] },
  "Status Webhook":       { main: [[{ node: "Get Status", type: "main", index: 0 }]] },
  "Get Status":           { main: [[{ node: "Send Status", type: "main", index: 0 }]] },
  "Sync All Webhook":     { main: [[{ node: "Sync All Workflows", type: "main", index: 0 }]] },
  "Sync All Workflows":   { main: [[{ node: "Send Sync Result", type: "main", index: 0 }]] },
  "Sync Single Webhook":  { main: [[{ node: "Sync Single Workflow", type: "main", index: 0 }]] },
  "Sync Single Workflow": { main: [[{ node: "Send Single Result", type: "main", index: 0 }]] },
  "History Webhook":      { main: [[{ node: "Get History", type: "main", index: 0 }]] },
  "Get History":          { main: [[{ node: "Send History", type: "main", index: 0 }]] },
  "Restore Webhook":      { main: [[{ node: "Restore Workflow", type: "main", index: 0 }]] },
  "Restore Workflow":     { main: [[{ node: "Send Restore Result", type: "main", index: 0 }]] },
  "Schedule Trigger":     { main: [[{ node: "Scheduled Sync", type: "main", index: 0 }]] }
};

const staticData = {
  global: {
    github_owner: env.GITHUB_OWNER || 'YOUR_GITHUB_USERNAME',
    github_repo: env.GITHUB_REPO || 'n8n-workflows-backup',
    github_branch: env.GITHUB_BRANCH || 'main',
    github_token: env.GITHUB_TOKEN || 'ghp_YOUR_GITHUB_TOKEN',
    n8n_base_url: env.N8N_BASE_URL || 'http://localhost:5678',
    n8n_api_key: env.N8N_API_KEY || 'YOUR_N8N_API_KEY',
    base_path: env.BASE_PATH || 'workflows'
  },
  'node:Schedule Trigger': { recurrenceRules: [] }
};

const workflow = {
  name: "\uD83D\uDD04 n8n \u2194 GitHub Sync + Dashboard",
  nodes, connections,
  settings: { executionOrder: "v1" },
  staticData: JSON.stringify(staticData)
};

writeFileSync(__dirname + '/n8n-github-sync-workflow.json', JSON.stringify(workflow, null, 2));
console.log('Done! ' + nodes.length + ' nodes, using helpers.httpRequest');
