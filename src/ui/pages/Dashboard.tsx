import type { FC } from 'hono/jsx';
import { Layout } from '../components/Layout';
import { AppCard } from '../components/AppCard';

interface DashboardProps {
  apps: { app_id: string; spreadsheet_id: string; created_at: string }[];
  authenticated: boolean;
  baseUrl: string;
  loadError?: string | null;
}

export const Dashboard: FC<DashboardProps> = ({ apps, authenticated, baseUrl, loadError }) => {
  const openApiUrl = `${baseUrl}/openapi.json`;

  return (
    <Layout title="gsdb — Dashboard">
      <div style={containerStyle}>
        {/* Header */}
        <header style={headerStyle}>
          <div>
            <h1 style={logoStyle}>
              <span style={accentStyle}>gs</span>db
            </h1>
            <p style={taglineStyle}>Google Sheets → REST API proxy</p>
          </div>
          <div style={headerActionsStyle}>
            {!authenticated && (
              <a href="/auth/login" style={loginBtnStyle}>
                Connect Google Account
              </a>
            )}
            {authenticated && (
              <span style={authBadgeStyle}>● Connected</span>
            )}
          </div>
        </header>

        {/* OpenAPI CTA — highly visible, as required by spec */}
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
            <span>📄</span> Swagger UI
          </a>
          <a href="/openapi.json" style={quickLinkStyle} target="_blank">
            <span>{ '{}'}</span> openapi.json
          </a>
          <a href="/auth/status" style={quickLinkStyle}>
            <span>🔐</span> Auth status
          </a>
        </div>

        {/* Apps section */}
        <section>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>Registered Apps</h2>
            <span style={countBadgeStyle}>{apps.length}</span>
          </div>

          {loadError && (
            <div style={errorBannerStyle}>
              <strong>Error loading app registry:</strong> {loadError}
            </div>
          )}

          {!loadError && apps.length === 0 ? (
            <div style={emptyStateStyle}>
              <p style={emptyTitleStyle}>No apps registered yet</p>
              <p style={emptyDescStyle}>
                Use the{' '}
                <code style={inlineCodeStyle}>POST /manage/apps</code> endpoint with
                your <code style={inlineCodeStyle}>X-Admin-Secret</code> header to add one.
              </p>
            </div>
          ) : !loadError ? (
            <div style={gridStyle}>
              {apps.map((app) => (
                <AppCard
                  key={app.app_id}
                  app_id={app.app_id}
                  spreadsheet_id={app.spreadsheet_id}
                  created_at={app.created_at}
                />
              ))}
            </div>
          ) : null}
        </section>

        {/* Footer */}
        <footer style={footerStyle}>
          <span>gsdb</span>
          <span>·</span>
          <a href="/docs">Docs</a>
          <span>·</span>
          <a href="https://github.com/slashtechno/gsdb" target="_blank" rel="noreferrer">GitHub</a>
        </footer>
      </div>
    </Layout>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────
const containerStyle = {
  maxWidth: '900px',
  margin: '0 auto',
  padding: '40px 24px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '32px',
};
const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
};
const logoStyle = { fontSize: '28px', fontWeight: '800', letterSpacing: '-1px' };
const accentStyle = { color: '#6c63ff' };
const taglineStyle = { color: '#94a3b8', fontSize: '14px', marginTop: '4px' };
const headerActionsStyle = { display: 'flex', alignItems: 'center', gap: '12px' };
const loginBtnStyle = {
  background: '#6c63ff',
  color: '#fff',
  padding: '8px 18px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: '600',
  textDecoration: 'none',
};
const authBadgeStyle = {
  color: '#22c55e',
  fontSize: '13px',
  fontWeight: '600',
  background: 'rgba(34,197,94,0.1)',
  padding: '6px 12px',
  borderRadius: '20px',
};

// The highly-visible CTA required by spec
const ctaBoxStyle = {
  background: 'linear-gradient(135deg, rgba(108,99,255,0.15) 0%, rgba(108,99,255,0.05) 100%)',
  border: '1.5px solid rgba(108,99,255,0.4)',
  borderRadius: '16px',
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
const countBadgeStyle = {
  background: '#2a2d3d',
  color: '#94a3b8',
  padding: '2px 10px',
  borderRadius: '12px',
  fontSize: '13px',
};

const emptyStateStyle = {
  background: '#1a1d27',
  border: '1px dashed #2a2d3d',
  borderRadius: '12px',
  padding: '48px 32px',
  textAlign: 'center' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '8px',
};
const emptyTitleStyle = { fontWeight: '600', color: '#e2e8f0' };
const emptyDescStyle = { color: '#64748b', fontSize: '14px' };
const inlineCodeStyle = {
  background: '#0f1117',
  padding: '2px 6px',
  borderRadius: '4px',
  fontFamily: 'var(--mono)',
  fontSize: '13px',
  color: '#6c63ff',
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

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: '16px',
};

const footerStyle = {
  display: 'flex',
  gap: '12px',
  color: '#475569',
  fontSize: '13px',
  paddingTop: '16px',
  borderTop: '1px solid #1e2132',
};
