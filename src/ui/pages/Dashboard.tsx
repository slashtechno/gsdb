import type { FC } from 'hono/jsx';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { AdminSecretModal } from '../components/AdminSecretModal';
import { PromptDialog } from '../components/PromptDialog';
import { KeyRevealModal } from '../components/KeyRevealModal';

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
            style={{ padding: '12px 24px', borderRadius: '10px', fontSize: '14px', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            Copy OpenAPI Schema URL
          </Button>
        </div>

        {/* Quick links */}
        <div style={quickLinksStyle}>
          <a href="/docs" style={quickLinkStyle}>
            📄 Swagger UI
          </a>
          <a href="/openapi.json" style={quickLinkStyle} target="_blank">
            ⚙️ OpenAPI JSON
          </a>
        </div>

        {/* Apps section */}
        <section>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>Registered Apps</h2>
            <Button onclick="openCreateAppModal()" style={{ marginLeft: 'auto' }}>
              + Create App
            </Button>
          </div>
          <div id="appsContainer" style={gridStyle} />
          <div id="loadError" style={errorBannerStyle} />
        </section>

        {/* Footer */}
        <footer style={footerStyle}>
          <span>gsdb</span>
          <span>·</span>
          <a href="/docs">Docs</a>
          <span>·</span>
          <a href="https://github.com/slashtechno/gsdb" target="_blank">GitHub</a>
        </footer>
      </div>

      {/* Admin auth modal (existing) */}
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
      {/* Pre-rendered key reveal modal — populated by JS after POST returns.
          Server renders it hidden with an empty key; JS overwrites the
          code block's textContent with the response, then shows it. */}
      <KeyRevealModal id="createAppKey" app_id="" api_key="" doneFn="doneCreateApp" doneLabel="Done" />

      <script dangerouslySetInnerHTML={{ __html: `
        // ── Modal show/hide helpers (id-prefixed) ────────────────────────
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
        // Named wrappers for the inline onclick= attributes.
        function showCreateApp() { showId('createApp'); }
        function hideCreateApp() { hideId('createApp'); }
        function showCreateAppKey() { showId('createAppKey'); }
        function hideCreateAppKey() { hideId('createAppKey'); }
        function openCreateAppModal() { showCreateApp(); }

        // Copy helper for the key reveal modal's <code> block.
        function copyKey(codeId) {
          var text = document.getElementById(codeId).textContent;
          navigator.clipboard.writeText(text).then(function() {
            var btn = event.target;
            var prev = btn.textContent;
            btn.textContent = '✓ Copied!';
            setTimeout(function() { btn.textContent = prev; }, 1500);
          }).catch(function() {});
        }

        // ── Admin secret modal (legacy ids) ─────────────────────────────
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

        // ── Apps list ──────────────────────────────────────────────────
        async function loadApps() {
          var secret = localStorage.getItem('gsdb_admin_secret');
          if (!secret) {
            showModal();
            return;
          }

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
        }

        // XSS-safe card template. Mirrors AppCard.tsx layout. All
        // interpolated values are escaped — DO NOT remove the esc() calls.
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
            + '<div style="background:#1a1d27;border:1px solid #2a2d3d;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px;">'
            +   '<div style="display:flex;justify-content:space-between;align-items:center;">'
            +     '<a href="/ui/apps/' + esc(app.app_id) + '" style="background:rgba(108,99,255,0.15);color:#6c63ff;padding:4px 10px;border-radius:20px;font-size:13px;font-weight:600;font-family:var(--mono);text-decoration:none;">' + esc(app.app_id) + '</a>'
            +     '<span style="color:#94a3b8;font-size:12px;">' + esc(date) + '</span>'
            +   '</div>'
            +   '<p style="font-size:13px;color:#94a3b8;margin:0;">'
            +     '<span style="color:#64748b;">Sheet ID: </span>'
            +     '<a href="https://docs.google.com/spreadsheets/d/' + esc(app.spreadsheet_id) + '" target="_blank" rel="noreferrer" style="color:#6c63ff;font-family:var(--mono);font-size:12px;">' + esc(app.spreadsheet_id.slice(0, 20)) + '…</a>'
            +   '</p>'
            +   '<div style="margin-top:4px;display:flex;align-items:center;justify-content:space-between;gap:8px;">'
            +     '<code style="background:#0f1117;color:#94a3b8;padding:4px 8px;border-radius:6px;font-size:12px;">/api/' + esc(app.app_id) + '/:table</code>'
            +     '<a href="/ui/apps/' + esc(app.app_id) + '" style="color:#6c63ff;font-size:13px;font-weight:600;text-decoration:none;padding:4px 8px;border-radius:6px;background:rgba(108,99,255,0.1);">Open →</a>'
            +   '</div>'
            + '</div>';
        }

        function renderApps(apps) {
          var container = document.getElementById('appsContainer');
          if (!apps.length) {
            container.innerHTML = '<div style="text-align:center;color:#666;padding:32px;">No apps yet. Create one to get started.</div>';
            return;
          }
          container.innerHTML = apps.map(renderAppCardHtml).join('');
        }

        // ── Create app flow ────────────────────────────────────────────
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
              // Populate the key reveal modal via its stable DOM IDs and show it.
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

        // Backwards-compat alias for the existing modal's onclick.
        window.clearAdminSecret = function() {
          localStorage.removeItem('gsdb_admin_secret');
          location.reload();
        };

        // Shared fetch wrapper: injects X-Admin-Secret for /manage/* calls.
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
};

const logoStyle = { fontSize: '28px', fontWeight: '800', letterSpacing: '-1px' };
const accentStyle = { color: '#6c63ff' };
const taglineStyle = { color: '#94a3b8', fontSize: '14px', marginTop: '4px' };

const headerActionsStyle = { display: 'flex', alignItems: 'center', gap: '12px' };

const ctaBoxStyle = {
  background: '#1a1d27',
  border: '1px solid #2a2d3d',
  borderRadius: '12px',
  padding: '28px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '24px',
  flexWrap: 'wrap' as const,
};

const ctaLeftStyle = { display: 'flex', flexDirection: 'column' as const, gap: '6px' };
const ctaTitleStyle = { fontWeight: '700', fontSize: '16px', color: '#e2e8f0' };
const ctaDescStyle = { color: '#94a3b8', fontSize: '13px', maxWidth: '420px' };

const ctaUrlStyle = {
  fontSize: '12px',
  color: '#6c63ff',
  background: 'rgba(108,99,255,0.1)',
  padding: '4px 8px',
  borderRadius: '6px',
  fontFamily: 'var(--mono)',
};

const quickLinksStyle = { display: 'flex', gap: '12px', flexWrap: 'wrap' as const };
const quickLinkStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 14px',
  background: '#1a1d27',
  border: '1px solid #2a2d3d',
  borderRadius: '8px',
  color: '#94a3b8',
  fontSize: '13px',
  textDecoration: 'none',
};

const sectionHeaderStyle = { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' };
const sectionTitleStyle = { fontSize: '18px', fontWeight: '700' };

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
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