import type { FC } from 'hono/jsx';

interface AppCardProps {
  app_id: string;
  spreadsheet_id: string;
  created_at: string | null;
}

export const AppCard: FC<AppCardProps> = ({ app_id, spreadsheet_id, created_at }) => (
  <div style={cardStyle}>
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

const cardStyle = {
  background: '#1a1d27',
  border: '1px solid #2a2d3d',
  borderRadius: '12px',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '12px',
  transition: 'border-color 0.2s',
};
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const badgeStyle = {
  background: 'rgba(108, 99, 255, 0.15)',
  color: '#6c63ff',
  padding: '4px 10px',
  borderRadius: '20px',
  fontSize: '13px',
  fontWeight: '600',
  fontFamily: 'var(--mono)',
  textDecoration: 'none',
};
const dateStyle = { color: '#94a3b8', fontSize: '12px' };
const sheetStyle = { fontSize: '13px', color: '#94a3b8' };
const labelStyle = { color: '#64748b' };
const linkStyle = { color: '#6c63ff', fontFamily: 'var(--mono)', fontSize: '12px' };
const actionsStyle = {
  marginTop: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
};
const endpointStyle = {
  background: '#0f1117',
  color: '#94a3b8',
  padding: '4px 8px',
  borderRadius: '6px',
  fontSize: '12px',
};
const openLinkStyle = {
  color: '#6c63ff',
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'none',
  padding: '4px 8px',
  borderRadius: '6px',
  background: 'rgba(108, 99, 255, 0.1)',
};
