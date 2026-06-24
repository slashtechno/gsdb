import type { FC, PropsWithChildren } from 'hono/jsx';

const FAVICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#7c74ff"/><stop offset="100%" stop-color="#6c63ff"/></linearGradient></defs><rect width="32" height="32" rx="7" fill="url(#g)"/><text x="16" y="21" text-anchor="middle" fill="#fff" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="15">gs</text></svg>`)}`;

export const Layout: FC<PropsWithChildren<{ title?: string }>> = ({
  title = 'gsdb',
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="theme-color" content="#0f1117" />
      <link rel="icon" type="image/svg+xml" href={FAVICON} />
      <link rel="alternate icon" href={FAVICON} />
      <title>{title}</title>
      <style dangerouslySetInnerHTML={{ __html: `
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #0f1117;
          --surface: #1a1d27;
          --border: #2a2d3d;
          --accent: #6c63ff;
          --accent-hover: #7c74ff;
          --accent-glow: rgba(108, 99, 255, 0.25);
          --success: #22c55e;
          --danger: #ef4444;
          --text: #e2e8f0;
          --muted: #94a3b8;
          --font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          --mono: 'JetBrains Mono', 'Fira Code', monospace;
          --radius: 8px;
          --radius-lg: 12px;
        }
        html { scroll-behavior: smooth; }
        body {
          font-family: var(--font);
          background: var(--bg);
          color: var(--text);
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        a { color: var(--accent); text-decoration: none; transition: opacity 0.15s; }
        a:hover { opacity: 0.85; text-decoration: underline; }
        code, pre { font-family: var(--mono); }
        ::selection { background: var(--accent); color: #fff; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: var(--bg); }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #3a3d4d; }
        :focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

        .page { animation: fadeIn 0.25s ease-out; }
        .card-hover { transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s; }
        .card-hover:hover {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px rgba(108, 99, 255, 0.15), 0 4px 20px rgba(0, 0, 0, 0.3);
          transform: translateY(-2px);
        }

        @media (max-width: 640px) {
          body { font-size: 15px; }
        }
      ` }} />
    </head>
    <body class="page">{children}</body>
  </html>
);
