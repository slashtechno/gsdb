import type { FC } from 'hono/jsx';
import { Layout } from '../components/Layout';
import { AdminSecretModal } from '../components/AdminSecretModal';

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
            <button onclick="clearAdminSecret()" style={logoutBtnStyle}>
              Logout
            </button>
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
          <button
            style={copyBtnStyle}
            onclick={`navigator.clipboard.writeText('${openApiUrl}').then(() => this.textContent = '✓ Copied!').catch(() => {}); setTimeout(() => this.textContent = 'Copy OpenAPI Schema URL', 2000);`}
          >
            Copy OpenAPI Schema URL
          </button>
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
            <button style={createBtnStyle}>+ Create App</button>
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

      {/* Modal */}
      <AdminSecretModal onSubmit="setAdminSecret()" />

      <script dangerouslySetInnerHTML={{ __html: `
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
          const secret = document.getElementById('secretInput').value;
          const errorEl = document.getElementById('modalError');
          errorEl.style.display = 'none';
          errorEl.textContent = '';

          if (!secret) return;

          try {
            const res = await fetch('/manage/apps', {
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
            errorEl.textContent = 'Error: ' + (err instanceof Error ? err.message : 'unknown');
            errorEl.style.display = 'block';
          }
        }

        async function loadApps() {
          const secret = localStorage.getItem('gsdb_admin_secret');
          if (!secret) {
            showModal();
            return;
          }

          try {
            const res = await fetch('/manage/apps', {
              headers: { 'X-Admin-Secret': secret },
            });

            if (res.ok) {
              const data = await res.json();
              document.getElementById('loadError').style.display = 'none';
              renderApps(data.apps || []);
            } else if (res.status === 403) {
              localStorage.removeItem('gsdb_admin_secret');
              showModal();
            } else {
              document.getElementById('loadError').textContent = 'Failed to load apps';
              document.getElementById('loadError').style.display = 'block';
            }
          } catch (err) {
            document.getElementById('loadError').textContent = 'Error: ' + (err instanceof Error ? err.message : 'unknown');
            document.getElementById('loadError').style.display = 'block';
          }
        }

        function renderApps(apps) {
          const container = document.getElementById('appsContainer');
          if (!apps.length) {
            container.innerHTML = '<div style="text-align:center;color:#666;padding:32px">No apps yet. Create one to get started.</div>';
            return;
          }
          container.innerHTML = apps.map(app => \`
            <div style="border:1px solid #2a2d3d;border-radius:8px;padding:16px;background:#1a1d27">
              <div style="font-weight:600;margin-bottom:8px">\${app.app_id}</div>
              <div style="font-size:12px;color:#666">Sheet: \${app.spreadsheet_id}</div>
              <div style="font-size:11px;color:#555;margin-top:8px">\${new Date(app.created_at).toLocaleDateString()}</div>
            </div>
          \`).join('');
        }

        window.clearAdminSecret = function() {
          localStorage.removeItem('gsdb_admin_secret');
          location.reload();
        };

        const originalFetch = window.fetch;
        window.fetch = function(resource, init) {
          const secret = localStorage.getItem('gsdb_admin_secret');
          if (secret && typeof resource === 'string' && resource.startsWith('/manage')) {
            init = init || {};
            init.headers = init.headers || {};
            init.headers['X-Admin-Secret'] = secret;
          }
          return originalFetch.apply(this, arguments);
        };

        function init() {
          const secret = localStorage.getItem('gsdb_admin_secret');
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

const logoutBtnStyle = {
  background: '#6c63ff',
  color: '#fff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '13px',
  cursor: 'pointer',
};

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

const copyBtnStyle = {
  background: '#6c63ff',
  color: '#fff',
  border: 'none',
  padding: '12px 24px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: '700',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
  flexShrink: 0,
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

const createBtnStyle = {
  background: '#6c63ff',
  color: '#fff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '13px',
  cursor: 'pointer',
  marginLeft: 'auto',
};

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
