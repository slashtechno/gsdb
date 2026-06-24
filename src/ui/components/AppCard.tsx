import type { FC } from 'hono/jsx';
import type { CSSProperties } from 'hono/jsx';

interface AppCardProps {
  app_id: string;
  spreadsheet_id: string;
  created_at: string | null;
}

export const AppCard: FC<AppCardProps> = ({ app_id, spreadsheet_id, created_at }) => (
  <div class="card-hover" style={cardStyle}>
    <div style={headerStyle}>
      <a href={`/ui/apps/${app_id}`} style={badgeStyle}>
        {app_id}
      </a>
      <span style={dateStyle}>{created_at ? new Date(created_at).toLocaleDateString() : '—'}</span>
    </div>
    <p style={sheetStyle}>
      <span style={labelStyle}>Sheet ID: </span>
      <a
        href={`https://docs.google.com/spreadsheets/d/${spreadsheet_id}`}
        target="_blank"
        rel="noreferrer"
        style={linkStyle}
      >
        {spreadsheet_id.slice(0, 20)}…
      </a>
    </p>
    <div style={actionsStyle}>
      <code style={endpointStyle}>/api/{app_id}/:table</code>
      <a href={`/ui/apps/${app_id}`} style={openLinkStyle}>
        Open →
      </a>
    </div>
  </div>
);

const cardStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};
const headerStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const badgeStyle: CSSProperties = {
  background: 'rgba(108, 99, 255, 0.15)',
  color: 'var(--accent)',
  padding: '4px 10px',
  borderRadius: '20px',
  fontSize: '13px',
  fontWeight: '600',
  fontFamily: 'var(--mono)',
  textDecoration: 'none',
  transition: 'background 0.15s',
};
const dateStyle: CSSProperties = { color: 'var(--muted)', fontSize: '12px' };
const sheetStyle: CSSProperties = { fontSize: '13px', color: 'var(--muted)' };
const labelStyle: CSSProperties = { color: '#64748b' };
const linkStyle: CSSProperties = { color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: '12px' };
const actionsStyle: CSSProperties = {
  marginTop: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
};
const endpointStyle: CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--muted)',
  padding: '4px 8px',
  borderRadius: '6px',
  fontSize: '12px',
};
const openLinkStyle: CSSProperties = {
  color: 'var(--accent)',
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'none',
  padding: '4px 8px',
  borderRadius: '6px',
  background: 'rgba(108, 99, 255, 0.1)',
  transition: 'background 0.15s',
};
