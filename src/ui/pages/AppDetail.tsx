import type { FC } from 'hono/jsx';
import { Layout } from '../components/Layout';
import { AppKeyModal } from '../components/AppKeyModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PromptDialog } from '../components/PromptDialog';
import { KeyRevealModal } from '../components/KeyRevealModal';
import { jsEmbed } from '../lib/escape';

interface AppDetailProps {
  app_id: string;
  baseUrl: string;
}

export const AppDetail: FC<AppDetailProps> = ({ app_id }) => {
  // The spreadsheet URL is server-side too, for the "Open in Google Sheets" link.
  return (
    <Layout title={`gsdb — ${app_id}`}>
      <div style={containerStyle}>
        <header style={headerStyle}>
          <div>
            <a href="/ui" style={backLinkStyle}>← All apps</a>
            <h1 style={appIdStyle}>{app_id}</h1>
            <p style={taglineStyle}>
              <a
                id="sheetLink"
                href="#"
                target="_blank"
                rel="noreferrer"
                style={sheetLinkStyle}
              >
                Open Google Sheet ↗
              </a>
            </p>
          </div>
          <div style={headerActionsStyle}>
            <button onclick="openCreateTableModal()" style={primaryBtnStyle}>
              + Create Table
            </button>
            <button onclick="showRotateApp()" style={secondaryBtnStyle}>
              Rotate API Key
            </button>
            <button onclick="showDeleteApp()" style={dangerBtnStyle}>
              Delete App
            </button>
          </div>
        </header>

        <div id="apiKeyBanner" style={keyBannerStyle} />

        <section>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>Tables</h2>
          </div>
          <div id="tablesContainer" style={gridStyle} />
          <div id="loadError" style={errorBannerStyle} />
        </section>

        <footer style={footerStyle}>
          <a href="/ui">← Back to dashboard</a>
        </footer>
      </div>

      {/* Per-app auth */}
      <AppKeyModal app_id={app_id} />

      {/* Table creation */}
      <PromptDialog
        id="createTable"
        title="Create Table"
        description="Creates a new tab in the app's spreadsheet. You can set columns afterward via PUT /{table}/schema."
        inputLabel="table name"
        placeholder="users"
        submitLabel="Create"
        submitFn="submitCreateTable"
      />

      {/* Destructive confirms */}
      <ConfirmDialog
        id="rotateApp"
        title="Rotate API Key"
        message="The current API key will stop working immediately. Any deployed clients will lose access until you update them with the new key."
        confirmLabel="Rotate"
        confirmFn="submitRotateApp"
        dangerous
      />
      <ConfirmDialog
        id="deleteApp"
        title="Delete App"
        message={`This permanently removes ${app_id} from the registry. The Google Sheet itself is not deleted — you can re-register the same sheet id later if needed.`}
        confirmLabel="Delete"
        confirmFn="submitDeleteApp"
        dangerous
      />

      {/* Reveal modal — populated by JS after rotate returns the new key */}
      <KeyRevealModal id="rotateAppKey" app_id={app_id} api_key="" doneFn="hideRotateAppKey" />

      <script dangerouslySetInnerHTML={{ __html: `
        var APP_ID = ${jsEmbed(app_id)};
        var KEY_STORAGE = 'gsdb_api_key:' + APP_ID;

        function getAppKey() {
          return sessionStorage.getItem(KEY_STORAGE);
        }
        function setAppKey(k) {
          sessionStorage.setItem(KEY_STORAGE, k);
        }
        function clearAppKey() {
          sessionStorage.removeItem(KEY_STORAGE);
        }

        // Modal helpers
        function showId(id) {
          document.getElementById(id + 'Modal').style.display = 'block';
          document.getElementById(id + 'Backdrop').style.display = 'block';
          var input = document.getElementById(id + 'Input');
          if (input) { input.value = ''; input.focus(); }
        }
        function hideId(id) {
          document.getElementById(id + 'Modal').style.display = 'none';
          document.getElementById(id + 'Backdrop').style.display = 'none';
          var err = document.getElementById(id + 'Error');
          if (err) { err.style.display = 'none'; err.textContent = ''; }
        }
        function showError(id, msg) {
          var err = document.getElementById(id + 'Error');
          if (!err) return;
          err.textContent = msg;
          err.style.display = 'block';
        }
        function showErrorBanner(msg) {
          var el = document.getElementById('loadError');
          el.textContent = msg;
          el.style.display = 'block';
        }
        function hideErrorBanner() {
          document.getElementById('loadError').style.display = 'none';
        }

        // Named wrappers used by inline onclick= attributes
        function showAppKey() { showId('appKey'); }
        function hideAppKey() { hideId('appKey'); }
        function showCreateTable() { showId('createTable'); }
        function hideCreateTable() { hideId('createTable'); }
        function openCreateTableModal() { showCreateTable(); }
        function showRotateApp() { showId('rotateApp'); }
        function hideRotateApp() { hideId('rotateApp'); }
        function showDeleteApp() { showId('deleteApp'); }
        function hideDeleteApp() { hideId('deleteApp'); }
        function showRotateAppKey() { showId('rotateAppKey'); }
        function hideRotateAppKey() { hideId('rotateAppKey'); }

        function copyKey(codeId) {
          var text = document.getElementById(codeId).textContent;
          navigator.clipboard.writeText(text).then(function() {
            var btn = event.target;
            var prev = btn.textContent;
            btn.textContent = '✓ Copied!';
            setTimeout(function() { btn.textContent = prev; }, 1500);
          }).catch(function() {});
        }

        // ── Key entry ────────────────────────────────────────────────
        function submitAppKey() {
          var input = document.getElementById('appKeyInput');
          var key = input.value.trim();
          if (!key) {
            showError('appKey', 'API key is required');
            return;
          }
          setAppKey(key);
          hideAppKey();
          // Re-run page init from scratch.
          init();
        }

        // ── Fetch wrapper ────────────────────────────────────────────
        // For /api/{app_id}/* calls: prefer X-Admin-Secret if the admin is logged in,
        // otherwise fall back to the per-app Bearer token.
        var originalFetch = window.fetch;
        window.fetch = function(resource, init) {
          if (typeof resource === 'string' && resource.startsWith('/api/' + APP_ID + '/')) {
            var secret = localStorage.getItem('gsdb_admin_secret');
            var key = getAppKey();
            init = init || {};
            init.headers = init.headers || {};
            if (secret) {
              init.headers['X-Admin-Secret'] = secret;
            } else if (key) {
              init.headers['Authorization'] = 'Bearer ' + key;
            }
          } else if (typeof resource === 'string' && resource.startsWith('/manage')) {
            var adminSecret = localStorage.getItem('gsdb_admin_secret');
            if (adminSecret) {
              init = init || {};
              init.headers = init.headers || {};
              init.headers['X-Admin-Secret'] = adminSecret;
            }
          }
          return originalFetch.call(this, resource, init).then(function(res) {
            if (typeof resource === 'string' && resource.startsWith('/api/' + APP_ID + '/') && (res.status === 401 || res.status === 403)) {
              var stillHasAdmin = !!localStorage.getItem('gsdb_admin_secret');
              if (!stillHasAdmin) {
                clearAppKey();
                renderKeyBanner('API key invalid or missing. Set it again to continue.');
                showAppKey();
              }
            }
            return res;
          });
        };

        function renderKeyBanner(text) {
          var el = document.getElementById('apiKeyBanner');
          if (!text) {
            el.style.display = 'none';
            el.textContent = '';
          } else {
            el.textContent = text;
            el.style.display = 'block';
          }
        }

        // ── Tables list ─────────────────────────────────────────────
        function esc(s) {
          if (s == null) return '';
          return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function renderTables(tables) {
          var container = document.getElementById('tablesContainer');
          if (!tables.length) {
            container.innerHTML = '<div style="text-align:center;color:#666;padding:32px;">No tables yet. Create one to get started.</div>';
            return;
          }
          container.innerHTML = tables.map(function(name) {
            return ''
              + '<a href="/ui/apps/' + esc(APP_ID) + '/' + esc(name) + '" style="background:#1a1d27;border:1px solid #2a2d3d;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:6px;text-decoration:none;color:inherit;transition:border-color 0.2s;">'
              +   '<div style="font-size:15px;font-weight:600;font-family:var(--mono);color:#e2e8f0;">' + esc(name) + '</div>'
              +   '<div style="font-size:12px;color:#64748b;">Open →</div>'
              + '</a>';
          }).join('');
        }

        async function loadTables() {
          try {
            var res = await fetch('/api/' + APP_ID + '/tables');
            if (res.ok) {
              var data = await res.json();
              hideErrorBanner();
              renderTables(data.tables || []);
            } else if (res.status === 401 || res.status === 403) {
              renderTables([]);
              renderKeyBanner('Set the API key to load tables.');
              showAppKey();
            } else {
              var err = await res.json().catch(function() { return { error: 'Failed to load' }; });
              showErrorBanner(err.error || ('HTTP ' + res.status));
            }
          } catch (err) {
            showErrorBanner(err.message || 'Network error');
          }
        }

        // ── Create table ────────────────────────────────────────────
        async function submitCreateTable() {
          var input = document.getElementById('createTableInput');
          var name = input.value.trim();
          if (!name) {
            showError('createTable', 'Table name is required');
            return;
          }
          try {
            var res = await fetch('/api/' + APP_ID + '/tables', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ table: name }),
            });
            if (res.ok) {
              hideCreateTable();
              loadTables();
            } else if (res.status === 400) {
              var err = await res.json().catch(function() { return { error: 'Bad request' }; });
              showError('createTable', err.error || 'Bad request');
            } else if (res.status === 401 || res.status === 403) {
              showError('createTable', 'Invalid API key');
            } else {
              var err2 = await res.json().catch(function() { return { error: 'HTTP ' + res.status }; });
              showError('createTable', err2.error || ('HTTP ' + res.status));
            }
          } catch (err) {
            showError('createTable', err.message || 'Network error');
          }
        }

        // ── Rotate key ──────────────────────────────────────────────
        async function submitRotateApp() {
          var secret = localStorage.getItem('gsdb_admin_secret');
          if (!secret) {
            hideRotateApp();
            location.href = '/ui';
            return;
          }
          try {
            var res = await fetch('/manage/apps/' + APP_ID + '/rotate', {
              method: 'POST',
              headers: { 'X-Admin-Secret': secret },
            });
            if (res.ok) {
              var data = await res.json();
              // CRITICAL: write new key BEFORE showing modal so the page keeps working.
              setAppKey(data.api_key);
              hideRotateApp();
              document.getElementById('rotateAppKeyAppId').textContent = data.app_id;
              document.getElementById('rotateAppKeyKey').textContent = data.api_key;
              showRotateAppKey();
              renderKeyBanner('');
            } else if (res.status === 404) {
              showError('rotateApp', 'App not found');
            } else {
              var err = await res.json().catch(function() { return { error: 'HTTP ' + res.status }; });
              showError('rotateApp', err.error || ('HTTP ' + res.status));
            }
          } catch (err) {
            showError('rotateApp', err.message || 'Network error');
          }
        }

        // ── Delete app ──────────────────────────────────────────────
        async function submitDeleteApp() {
          var secret = localStorage.getItem('gsdb_admin_secret');
          if (!secret) {
            hideDeleteApp();
            location.href = '/ui';
            return;
          }
          try {
            var res = await fetch('/manage/apps/' + APP_ID, {
              method: 'DELETE',
              headers: { 'X-Admin-Secret': secret },
            });
            if (res.ok) {
              clearAppKey();
              location.href = '/ui';
            } else if (res.status === 404) {
              showError('deleteApp', 'App not found');
            } else {
              var err = await res.json().catch(function() { return { error: 'HTTP ' + res.status }; });
              showError('deleteApp', err.error || ('HTTP ' + res.status));
            }
          } catch (err) {
            showError('deleteApp', err.message || 'Network error');
          }
        }

        function init() {
          var hasAdmin = !!localStorage.getItem('gsdb_admin_secret');
          if (!hasAdmin && !getAppKey()) {
            renderTables([]);
            showAppKey();
            return;
          }
          loadTables();
        }

        init();
      ` }} />
    </Layout>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────
const containerStyle = {
  maxWidth: '900px',
  margin: '0 auto',
  padding: '40px 24px',
  display: 'flex' as const,
  flexDirection: 'column' as const,
  gap: '32px',
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '24px',
  flexWrap: 'wrap' as const,
};

const backLinkStyle = {
  color: 'var(--muted)',
  fontSize: '13px',
  textDecoration: 'none',
};

const appIdStyle = {
  fontSize: '28px',
  fontWeight: '800',
  letterSpacing: '-1px',
  fontFamily: 'var(--mono)',
  margin: '4px 0 0 0',
  color: 'var(--text)',
};

const taglineStyle = { color: '#94a3b8', fontSize: '14px', marginTop: '8px' };
const sheetLinkStyle = { color: '#6c63ff', fontSize: '13px' };

const headerActionsStyle = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const };

const primaryBtnStyle = {
  background: '#6c63ff',
  color: '#fff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtnStyle = {
  background: 'transparent',
  color: 'var(--muted)',
  border: '1px solid var(--border)',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '13px',
  cursor: 'pointer',
};

const dangerBtnStyle = {
  background: 'transparent',
  color: 'var(--danger)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '13px',
  cursor: 'pointer',
};

const keyBannerStyle = {
  background: 'rgba(108, 99, 255, 0.1)',
  border: '1px solid rgba(108, 99, 255, 0.3)',
  borderRadius: '8px',
  padding: '12px 16px',
  color: '#c4b5fd',
  fontSize: '14px',
  display: 'none',
};

const sectionHeaderStyle = { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' };
const sectionTitleStyle = { fontSize: '18px', fontWeight: '700' };

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: '16px',
};

const errorBannerStyle = {
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  borderRadius: '8px',
  padding: '12px 16px',
  color: '#fca5a5',
  fontSize: '14px',
  marginBottom: '16px',
};

const footerStyle = {
  display: 'flex',
  gap: '12px',
  color: '#475569',
  fontSize: '13px',
  paddingTop: '16px',
  borderTop: '1px solid #1e2132',
};