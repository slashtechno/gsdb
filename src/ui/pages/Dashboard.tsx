import type { FC } from 'hono/jsx';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { AdminSecretModal } from '../components/AdminSecretModal';
import { PromptDialog } from '../components/PromptDialog';
import { KeyRevealModal } from '../components/KeyRevealModal';
import * as styles from '../styles';

interface DashboardProps {
  baseUrl: string;
}

export const Dashboard: FC<DashboardProps> = ({ baseUrl }) => {
  const openApiUrl = `${baseUrl}/openapi.json`;

  return (
    <Layout title="gsdb — Dashboard">
      <div style={containerStyle} id="dashboardContent">
        {/* Header */}
        <header style={headerStyle}>
          <div>
            <h1 style={logoStyle}>
              <span style={accentStyle}>gs</span>db
            </h1>
            <p style={taglineStyle}>Google Sheets → REST API proxy</p>
          </div>
          <div style={headerActionsStyle}>
            <Button onclick="clearAdminSecret()">
              Logout
            </Button>
          </div>
        </header>

        {/* OpenAPI CTA */}
        <div style={ctaBoxStyle}>
          <div style={ctaLeftStyle}>
            <div style={ctaTitleStyle}>OpenAPI Schema</div>
            <p style={ctaDescStyle}>
              Share this URL with any LLM or coding agent to give it full API access.
            </p>
            <code style={ctaUrlStyle}>{openApiUrl}</code>
          </div>
          <Button
            onclick={`navigator.clipboard.writeText('${openApiUrl}').then(() => this.textContent = '✓ Copied!').catch(() => {}); setTimeout(() => this.textContent = 'Copy OpenAPI Schema URL', 2000);`}
            style={ctaBtnStyle}
          >
            Copy OpenAPI Schema URL
          </Button>
        </div>

        {/* Quick links */}
        <div style={quickLinksStyle}>
          <a href="/docs" style={quickLinkStyle}>
            <span style={linkIconStyle}>📄</span>
            Swagger UI
          </a>
          <a href="/openapi.json" style={quickLinkStyle} target="_blank">
            <span style={linkIconStyle}>⚙️</span>
            OpenAPI JSON
          </a>
        </div>

        {/* Apps section */}
        <section>
          <div style={styles.sectionHeaderStyle}>
            <h2 style={styles.sectionTitleStyle}>Registered Apps</h2>
            <Button onclick="openCreateAppModal()" style={{ marginLeft: 'auto' }}>
              + Create App
            </Button>
          </div>
          <div id="appsContainer" style={gridStyle}>
            <div id="loadingState" style={loadingStyle}>Loading apps…</div>
          </div>
          <div id="loadError" style={styles.errorBannerStyle} />
        </section>

        {/* Footer */}
        <footer style={styles.footerStyle}>
          <span>gsdb</span>
          <span>·</span>
          <a href="/docs">Docs</a>
          <span>·</span>
          <a href="https://github.com/slashtechno/gsdb" target="_blank">GitHub</a>
        </footer>
      </div>

      {/* Admin auth modal */}
      <AdminSecretModal onSubmit="setAdminSecret()" />

      {/* Create-app flow */}
      <PromptDialog
        id="createApp"
        title="Create App"
        description="Pick an app_id — letters, digits, and dashes. You'll get a new Google Sheet and an API key."
        inputLabel="app_id"
        placeholder="my-app"
        submitLabel="Create"
        submitFn="submitCreateApp"
      />
      <KeyRevealModal id="createAppKey" app_id="" api_key="" doneFn="doneCreateApp" doneLabel="Done" />

      <script dangerouslySetInnerHTML={{ __html: `
        // ── Modal show/hide helpers ─────────────────────────────────
        function showId(id) {
          document.getElementById(id + 'Modal').style.display = 'block';
          document.getElementById(id + 'Backdrop').style.display = 'block';
          var input = document.getElementById(id + 'Input');
          if (input) input.focus();
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
        function hideError(id) {
          var err = document.getElementById(id + 'Error');
          if (!err) return;
          err.style.display = 'none';
          err.textContent = '';
        }
        function showCreateApp() { showId('createApp'); }
        function hideCreateApp() { hideId('createApp'); }
        function showCreateAppKey() { showId('createAppKey'); }
        function hideCreateAppKey() { hideId('createAppKey'); }
        function openCreateAppModal() { showCreateApp(); }

        function copyKey(codeId) {
          var text = document.getElementById(codeId).textContent;
          navigator.clipboard.writeText(text).then(function() {
            var btn = event.target;
            var prev = btn.textContent;
            btn.textContent = '✓ Copied!';
            setTimeout(function() { btn.textContent = prev; }, 1500);
          }).catch(function() {});
        }

        // ── Admin secret modal ──────────────────────────────────────
        function showModal() {
          document.getElementById('adminModal').style.display = 'block';
          document.getElementById('modalBackdrop').style.display = 'block';
          document.getElementById('dashboardContent').style.display = 'none';
          document.getElementById('secretInput').focus();
        }
        function hideModal() {
          document.getElementById('adminModal').style.display = 'none';
          document.getElementById('modalBackdrop').style.display = 'none';
          document.getElementById('dashboardContent').style.display = 'flex';
        }

        async function setAdminSecret() {
          var secret = document.getElementById('secretInput').value;
          var errorEl = document.getElementById('modalError');
          errorEl.style.display = 'none';
          errorEl.textContent = '';

          if (!secret) return;

          try {
            var res = await fetch('/manage/apps', {
              method: 'GET',
              headers: { 'X-Admin-Secret': secret },
            });

            if (res.ok) {
              localStorage.setItem('gsdb_admin_secret', secret);
              hideModal();
              loadApps();
            } else if (res.status === 403) {
              errorEl.textContent = 'Invalid admin secret';
              errorEl.style.display = 'block';
              document.getElementById('secretInput').value = '';
            } else {
              errorEl.textContent = 'Error validating secret';
              errorEl.style.display = 'block';
            }
          } catch (err) {
            errorEl.textContent = 'Error: ' + (err.message || 'unknown');
            errorEl.style.display = 'block';
          }
        }

        // ── Apps list ──────────────────────────────────────────────
        async function loadApps() {
          var secret = localStorage.getItem('gsdb_admin_secret');
          if (!secret) {
            showModal();
            return;
          }

          var loading = document.getElementById('loadingState');
          if (loading) loading.style.display = 'block';

          try {
            var res = await fetch('/manage/apps', {
              headers: { 'X-Admin-Secret': secret },
            });

            if (res.ok) {
              var data = await res.json();
              document.getElementById('loadError').style.display = 'none';
              renderApps(data || []);
            } else if (res.status === 403) {
              localStorage.removeItem('gsdb_admin_secret');
              showModal();
            } else {
              document.getElementById('loadError').textContent = 'Failed to load apps';
              document.getElementById('loadError').style.display = 'block';
            }
          } catch (err) {
            document.getElementById('loadError').textContent = 'Error: ' + (err.message || 'unknown');
            document.getElementById('loadError').style.display = 'block';
          }
          if (loading) loading.style.display = 'none';
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

        function renderAppCardHtml(app) {
          var date = app.created_at ? new Date(app.created_at).toLocaleDateString() : '—';
          return ''
            + '<div class="card-hover" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;display:flex;flex-direction:column;gap:12px;animation:slideUp 0.3s ease-out both;">'
            +   '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
            +     '<a href="/ui/apps/' + esc(app.app_id) + '" style="display:inline-block;background:rgba(108,99,255,0.15);color:var(--accent);padding:4px 10px;border-radius:20px;font-size:13px;font-weight:600;font-family:var(--mono);text-decoration:none;transition:background 0.15s;">' + esc(app.app_id) + '</a>'
            +     '<span style="color:var(--muted);font-size:12px;white-space:nowrap;">' + esc(date) + '</span>'
            +   '</div>'
            +   '<p style="font-size:13px;color:var(--muted);margin:0;">'
            +     '<span style="color:#64748b;">Sheet ID: </span>'
            +     '<a href="https://docs.google.com/spreadsheets/d/' + esc(app.spreadsheet_id) + '" target="_blank" rel="noreferrer" style="color:var(--accent);font-family:var(--mono);font-size:12px;">' + esc(app.spreadsheet_id.slice(0, 20)) + '…</a>'
            +   '</p>'
            +   '<div style="margin-top:4px;display:flex;align-items:center;justify-content:space-between;gap:8px;">'
            +     '<code style="background:var(--bg);color:var(--muted);padding:4px 8px;border-radius:6px;font-size:12px;">/api/' + esc(app.app_id) + '/:table</code>'
            +     '<a href="/ui/apps/' + esc(app.app_id) + '" style="color:var(--accent);font-size:13px;font-weight:600;text-decoration:none;padding:4px 8px;border-radius:6px;background:rgba(108,99,255,0.1);transition:background 0.15s;">Open →</a>'
            +   '</div>'
            + '</div>';
        }

        function renderApps(apps) {
          var container = document.getElementById('appsContainer');
          if (!apps.length) {
            container.innerHTML = '<div style="text-align:center;color:#64748b;padding:48px 24px;font-size:14px;line-height:1.6;">No apps yet. <span style="display:block;margin-top:8px;">Create one to get started.</span></div>';
            return;
          }
          container.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;animation:fadeIn 0.3s ease-out;">' + apps.map(function(app, i) {
            var card = renderAppCardHtml(app);
            return card;
          }).join('') + '</div>';
        }

        // ── Create app ─────────────────────────────────────────────
        async function submitCreateApp() {
          var input = document.getElementById('createAppInput');
          var appId = input.value.trim();
          hideError('createApp');
          if (!appId) {
            showError('createApp', 'app_id is required');
            return;
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(appId)) {
            showError('createApp', 'Only letters, digits, underscores, and dashes');
            return;
          }

          var secret = localStorage.getItem('gsdb_admin_secret');
          if (!secret) { showModal(); return; }

          try {
            var res = await fetch('/manage/apps', {
              method: 'POST',
              headers: { 'X-Admin-Secret': secret, 'Content-Type': 'application/json' },
              body: JSON.stringify({ app_id: appId }),
            });

            if (res.status === 201) {
              var data = await res.json();
              hideCreateApp();
              document.getElementById('createAppKeyTitle').textContent = 'Save your API key for ' + data.app_id;
              document.getElementById('createAppKeyAppId').textContent = data.app_id;
              document.getElementById('createAppKeyKey').textContent = data.api_key;
              showCreateAppKey();
              input.value = '';
            } else if (res.status === 409) {
              showError('createApp', 'app_id already exists');
            } else if (res.status === 403) {
              localStorage.removeItem('gsdb_admin_secret');
              hideCreateApp();
              showModal();
            } else {
              var err = await res.json().catch(function() { return { error: 'Unknown error' }; });
              showError('createApp', err.error || ('HTTP ' + res.status));
            }
          } catch (err) {
            showError('createApp', err.message || 'Network error');
          }
        }

        function doneCreateApp() {
          hideCreateAppKey();
          loadApps();
        }

        window.clearAdminSecret = function() {
          localStorage.removeItem('gsdb_admin_secret');
          location.reload();
        };

        var originalFetch = window.fetch;
        window.fetch = function(resource, init) {
          var secret = localStorage.getItem('gsdb_admin_secret');
          if (secret && typeof resource === 'string' && resource.startsWith('/manage')) {
            init = init || {};
            init.headers = init.headers || {};
            init.headers['X-Admin-Secret'] = secret;
          }
          return originalFetch.apply(this, arguments);
        };

        function init() {
          var secret = localStorage.getItem('gsdb_admin_secret');
          if (!secret) {
            showModal();
          } else {
            loadApps();
          }
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
};

const logoStyle = { fontSize: '28px', fontWeight: '800', letterSpacing: '-1px' };
const accentStyle = { color: 'var(--accent)' };
const taglineStyle = { color: 'var(--muted)', fontSize: '14px', marginTop: '4px' };

const headerActionsStyle = { display: 'flex', alignItems: 'center', gap: '12px' };

const ctaBoxStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: '28px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '24px',
  flexWrap: 'wrap' as const,
};

const ctaLeftStyle = { display: 'flex', flexDirection: 'column' as const, gap: '6px' };
const ctaTitleStyle = { fontWeight: '700', fontSize: '16px', color: 'var(--text)' };
const ctaDescStyle = { color: 'var(--muted)', fontSize: '13px', maxWidth: '420px' };

const ctaUrlStyle = {
  fontSize: '12px',
  color: 'var(--accent)',
  background: 'rgba(108,99,255,0.1)',
  padding: '4px 8px',
  borderRadius: '6px',
  fontFamily: 'var(--mono)',
};

const ctaBtnStyle = {
  padding: '12px 24px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 700,
  whiteSpace: 'nowrap' as const,
  flexShrink: 0,
};

const quickLinksStyle = { display: 'flex', gap: '12px', flexWrap: 'wrap' as const };
const linkIconStyle = { display: 'inline-block' };
const quickLinkStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 14px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--muted)',
  fontSize: '13px',
  textDecoration: 'none',
  transition: 'border-color 0.15s, color 0.15s',
};

const gridStyle = {
  display: 'block',
};

const loadingStyle = {
  textAlign: 'center' as const,
  color: '#64748b',
  padding: '32px',
  fontSize: '14px',
  animation: 'pulse 1.5s ease-in-out infinite',
};
