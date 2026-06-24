import type { FC } from 'hono/jsx';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { AppKeyModal } from '../components/AppKeyModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PromptDialog } from '../components/PromptDialog';
import { KeyRevealModal } from '../components/KeyRevealModal';
import { jsEmbed } from '../lib/escape';
import * as styles from '../styles';

interface AppDetailProps {
  app_id: string;
  baseUrl: string;
}

export const AppDetail: FC<AppDetailProps> = ({ app_id, baseUrl }) => {
  return (
    <Layout title={`gsdb — ${app_id}`}>
      <div style={containerStyle}>
        <header style={headerStyle}>
          <div style={headerLeftStyle}>
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
            <Button onclick="openCreateTableModal()">
              + Create Table
            </Button>
            <Button variant="secondary" onclick="showRotateApp()">
              Rotate Key
            </Button>
            <Button variant="danger" onclick="showDeleteApp()">
              Delete
            </Button>
          </div>
        </header>

        <div id="apiKeyBanner" style={keyBannerStyle} />

        <section>
          <div style={styles.sectionHeaderStyle}>
            <h2 style={styles.sectionTitleStyle}>Tables</h2>
          </div>
          <div id="tablesContainer" style={gridStyle} />
          <div id="loadError" style={styles.errorBannerStyle} />
        </section>

        <footer style={styles.footerStyle}>
          <a href="/ui">← Back to dashboard</a>
        </footer>
      </div>

      <AppKeyModal app_id={app_id} />

      <PromptDialog
        id="createTable"
        title="Create Table"
        description="Creates a new tab in the app's spreadsheet. You can set columns afterward via PUT /{table}/schema."
        inputLabel="table name"
        placeholder="users"
        submitLabel="Create"
        submitFn="submitCreateTable"
      />

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
        message={`This permanently removes ${app_id} from the registry. The Google Sheet itself is not deleted.`}
        confirmLabel="Delete"
        confirmFn="submitDeleteApp"
        dangerous
      />

      <KeyRevealModal id="rotateAppKey" app_id={app_id} api_key="" doneFn="hideRotateAppKey" />

      <script dangerouslySetInnerHTML={{ __html: `
        var APP_ID = ${jsEmbed(app_id)};
        var KEY_STORAGE = 'gsdb_api_key:' + APP_ID;

        function getAppKey() { return sessionStorage.getItem(KEY_STORAGE); }
        function setAppKey(k) { sessionStorage.setItem(KEY_STORAGE, k); }
        function clearAppKey() { sessionStorage.removeItem(KEY_STORAGE); }

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

        function submitAppKey() {
          var input = document.getElementById('appKeyInput');
          var key = input.value.trim();
          if (!key) {
            showError('appKey', 'API key is required');
            return;
          }
          setAppKey(key);
          hideAppKey();
          init();
        }

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
            container.innerHTML = '<div style="text-align:center;color:#64748b;padding:48px 24px;font-size:14px;line-height:1.6;">No tables yet. <span style="display:block;margin-top:8px;">Create one to get started.</span></div>';
            return;
          }
          container.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;animation:fadeIn 0.3s ease-out;">' + tables.map(function(name) {
            return ''
              + '<a href="/ui/apps/' + esc(APP_ID) + '/' + esc(name) + '" class="card-hover" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;display:flex;flex-direction:column;gap:8px;text-decoration:none;color:inherit;">'
              +   '<div style="font-size:16px;font-weight:600;font-family:var(--mono);color:var(--text);">' + esc(name) + '</div>'
              +   '<div style="font-size:12px;color:#64748b;margin-top:4px;">Open →</div>'
              + '</a>';
          }).join('') + '</div>';
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

const containerStyle = {
  maxWidth: '960px',
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

const headerLeftStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '4px',
};

const backLinkStyle = {
  color: 'var(--muted)',
  fontSize: '13px',
  textDecoration: 'none',
  display: 'inline-block',
  marginBottom: '4px',
};

const appIdStyle = {
  fontSize: '28px',
  fontWeight: '800',
  letterSpacing: '-1px',
  fontFamily: 'var(--mono)',
  margin: '0',
  color: 'var(--text)',
};

const taglineStyle = { color: 'var(--muted)', fontSize: '14px', marginTop: '4px' };
const sheetLinkStyle = { color: 'var(--accent)', fontSize: '13px' };

const headerActionsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap' as const,
};

const keyBannerStyle = {
  background: 'rgba(108, 99, 255, 0.1)',
  border: '1px solid rgba(108, 99, 255, 0.3)',
  borderRadius: 'var(--radius)',
  padding: '12px 16px',
  color: '#c4b5fd',
  fontSize: '14px',
  display: 'none',
};

const gridStyle = {
  display: 'block',
};
