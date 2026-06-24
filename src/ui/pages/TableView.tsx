import type { FC } from 'hono/jsx';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { AppKeyModal } from '../components/AppKeyModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PromptDialog } from '../components/PromptDialog';
import { jsEmbed } from '../lib/escape';
import * as styles from '../styles';
import { inputStyle } from '../styles';

interface TableViewProps {
  app_id: string;
  table: string;
}

const ROW_LIMIT = 50;

export const TableView: FC<TableViewProps> = ({ app_id, table }) => (
  <Layout title={`gsdb — ${app_id}/${table}`}>
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div>
          <a href={`/ui/apps/${app_id}`} style={backLinkStyle}>
            ← {app_id}
          </a>
          <h1 style={tableTitleStyle}>{table}</h1>
          <p style={taglineStyle}>
            <code style={endpointStyle}>/api/{app_id}/{table}</code>
          </p>
        </div>
        <div style={headerActionsStyle}>
          <Button id="manageToggle" onclick="toggleManage()">
            Manage Schema
          </Button>
        </div>
      </header>

      <div id="apiKeyBanner" style={keyBannerStyle} />

      <section>
        <div style={styles.sectionHeaderStyle}>
          <h2 style={styles.sectionTitleStyle}>Columns</h2>
        </div>
        <div id="columnsContainer" style={columnsContainerStyle} />
        <div id="manageBar" style={manageBarStyle}>
          <input id="newColumnInput" type="text" placeholder="new_column" style={addColumnInputStyle} />
          <Button onclick="submitAddColumn()">+ Add</Button>
        </div>
        <div id="schemaError" style={styles.errorBannerStyle} />
      </section>

      <section>
        <div style={sectionHeaderRowStyle}>
          <div style={styles.sectionHeaderStyle}>
            <h2 style={styles.sectionTitleStyle}>Rows</h2>
            <span id="rowsMeta" style={mutedStyle}>—</span>
          </div>
        </div>
        <div id="rowsWrapper" style={rowsWrapperStyle}>
          <div id="rowsContainer" style={rowsContainerStyle} />
        </div>
        <div id="rowsError" style={styles.errorBannerStyle} />
      </section>

      <footer style={styles.footerStyle}>
        <a href={`/ui/apps/${app_id}`}>← Back to {app_id}</a>
      </footer>
    </div>

    <AppKeyModal app_id={app_id} />

    <PromptDialog
      id="renameColumn"
      title="Rename Column"
      description="Header is renamed in place — data rows keep their positions."
      inputLabel="new name"
      submitLabel="Rename"
      submitFn="submitRenameColumn"
    />
    <PromptDialog
      id="confirmColumnName"
      title="Add Column"
      description="Adds a new column at the end of the schema. Existing rows will have null for this column."
      inputLabel="column name"
      submitLabel="Add"
      submitFn="submitAddColumnFromDialog"
    />

    <ConfirmDialog
      id="removeColumn"
      title="Remove Column"
      message="This deletes the column header AND all data in that column. Cannot be undone."
      confirmLabel="Remove"
      confirmFn="submitRemoveColumn"
      dangerous
    />

    <script dangerouslySetInnerHTML={{ __html: `
        var APP_ID = ${jsEmbed(app_id)};
        var TABLE = ${jsEmbed(table)};
        var KEY_STORAGE = 'gsdb_api_key:' + APP_ID;
        var ROW_LIMIT = ${ROW_LIMIT};

        var manageMode = false;
        var columns = [];
        var renameTarget = null;

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
        function clearError(id) {
          var err = document.getElementById(id + 'Error');
          if (!err) return;
          err.style.display = 'none';
          err.textContent = '';
        }
        function showErrorBanner(id, msg) {
          var el = document.getElementById(id);
          el.textContent = msg;
          el.style.display = 'block';
        }
        function hideErrorBanner(id) {
          document.getElementById(id).style.display = 'none';
        }
        function showAppKey() { showId('appKey'); }
        function hideAppKey() { hideId('appKey'); }
        function showRenameColumn() { showId('renameColumn'); }
        function hideRenameColumn() { hideId('renameColumn'); }
        function showConfirmColumnName() { showId('confirmColumnName'); }
        function hideConfirmColumnName() { hideId('confirmColumnName'); }
        function showRemoveColumn() { showId('removeColumn'); }
        function hideRemoveColumn() { hideId('removeColumn'); }

        function renderKeyBanner(text) {
          var el = document.getElementById('apiKeyBanner');
          if (!text) { el.style.display = 'none'; el.textContent = ''; }
          else { el.textContent = text; el.style.display = 'block'; }
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
          }
          return originalFetch.call(this, resource, init).then(function(res) {
            if (typeof resource === 'string' && resource.startsWith('/api/' + APP_ID + '/') && (res.status === 401 || res.status === 403)) {
              var stillHasAdmin = !!localStorage.getItem('gsdb_admin_secret');
              if (!stillHasAdmin) {
                clearAppKey();
                renderKeyBanner('API key invalid or missing.');
                showAppKey();
              }
            }
            return res;
          });
        };

        // ── Manage schema ──────────────────────────────────────────
        function toggleManage() {
          manageMode = !manageMode;
          var btn = document.getElementById('manageToggle');
          var bar = document.getElementById('manageBar');
          btn.textContent = manageMode ? 'Done' : 'Manage Schema';
          btn.style.background = manageMode ? 'var(--success, #22c55e)' : 'var(--accent)';
          bar.style.display = manageMode ? 'flex' : 'none';
          renderColumns();
        }

        function renderColumns() {
          var container = document.getElementById('columnsContainer');
          container.innerHTML = '';
          if (!columns.length) {
            var empty = document.createElement('div');
            empty.style.cssText = 'color:#64748b;padding:32px;text-align:center;font-size:14px;';
            empty.textContent = 'No columns yet. Use Manage Schema to add one.';
            container.appendChild(empty);
            return;
          }
          columns.forEach(function(name) {
            var chip = document.createElement('div');
            chip.style.cssText = 'background:rgba(108,99,255,0.12);color:var(--accent);padding:6px 12px;border-radius:20px;font-size:13px;font-weight:600;font-family:var(--mono);display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(108,99,255,0.2);transition:border-color 0.15s;';
            var label = document.createElement('span');
            label.textContent = name;
            chip.appendChild(label);
            if (manageMode) {
              var renameBtn = document.createElement('button');
              renameBtn.textContent = 'Rename';
              renameBtn.style.cssText = 'background:transparent;color:var(--accent);border:1px solid rgba(108,99,255,0.3);padding:2px 8px;border-radius:6px;font-size:11px;cursor:pointer;transition:background 0.15s;';
              renameBtn.onclick = (function(n) { return function() { openRename(n); }; })(name);
              chip.appendChild(renameBtn);

              var removeBtn = document.createElement('button');
              removeBtn.textContent = '✕';
              removeBtn.style.cssText = 'background:transparent;color:var(--danger);border:none;padding:0 6px;font-size:13px;cursor:pointer;font-weight:700;opacity:0.7;transition:opacity 0.15s;';
              removeBtn.title = 'Remove column';
              removeBtn.onclick = (function(n) { return function() { openRemove(n); }; })(name);
              chip.appendChild(removeBtn);
            }
            container.appendChild(chip);
          });
        }

        function openRename(name) {
          renameTarget = name;
          var input = document.getElementById('renameColumnInput');
          input.value = name;
          showRenameColumn();
        }
        function openRemove(name) {
          renameTarget = name;
          showRemoveColumn();
        }

        async function submitAddColumn() {
          var input = document.getElementById('newColumnInput');
          var name = input.value.trim();
          if (!name) return;
          input.value = '';
          await addColumnRequest(name);
        }
        async function submitAddColumnFromDialog() {
          var input = document.getElementById('confirmColumnNameInput');
          var name = input.value.trim();
          if (!name) {
            showError('confirmColumnName', 'Column name is required');
            return;
          }
          hideConfirmColumnName();
          await addColumnRequest(name);
        }
        async function addColumnRequest(name) {
          clearError('schema');
          try {
            var res = await fetch('/api/' + APP_ID + '/' + TABLE + '/schema/' + encodeURIComponent(name), {
              method: 'POST',
            });
            if (res.ok) {
              await refreshAll();
            } else {
              var err = await res.json().catch(function() { return { error: 'HTTP ' + res.status }; });
              showErrorBanner('schemaError', err.error || ('HTTP ' + res.status));
            }
          } catch (err) {
            showErrorBanner('schemaError', err.message || 'Network error');
          }
        }

        async function submitRenameColumn() {
          if (!renameTarget) { hideRenameColumn(); return; }
          var input = document.getElementById('renameColumnInput');
          var newName = input.value.trim();
          if (!newName) {
            showError('renameColumn', 'New name is required');
            return;
          }
          if (newName === renameTarget) {
            hideRenameColumn();
            return;
          }
          var from = renameTarget;
          hideRenameColumn();
          try {
            var res = await fetch('/api/' + APP_ID + '/' + TABLE + '/schema/' + encodeURIComponent(from), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: newName }),
            });
            if (res.ok) {
              await refreshAll();
            } else {
              var err = await res.json().catch(function() { return { error: 'HTTP ' + res.status }; });
              showErrorBanner('schemaError', err.error || ('HTTP ' + res.status));
            }
          } catch (err) {
            showErrorBanner('schemaError', err.message || 'Network error');
          }
        }

        async function submitRemoveColumn() {
          if (!renameTarget) { hideRemoveColumn(); return; }
          var name = renameTarget;
          hideRemoveColumn();
          try {
            var res = await fetch('/api/' + APP_ID + '/' + TABLE + '/schema/' + encodeURIComponent(name), {
              method: 'DELETE',
            });
            if (res.ok) {
              await refreshAll();
            } else {
              var err = await res.json().catch(function() { return { error: 'HTTP ' + res.status }; });
              showErrorBanner('schemaError', err.error || ('HTTP ' + res.status));
            }
          } catch (err) {
            showErrorBanner('schemaError', err.message || 'Network error');
          }
        }

        // ── Rows ────────────────────────────────────────────────────
        function renderRows(rows) {
          var container = document.getElementById('rowsContainer');
          var meta = document.getElementById('rowsMeta');
          container.innerHTML = '';

          if (!rows.length) {
            var empty = document.createElement('div');
            empty.style.cssText = 'color:#64748b;padding:32px;text-align:center;font-size:14px;';
            empty.textContent = 'No rows yet.';
            container.appendChild(empty);
            meta.textContent = '0 rows';
            return;
          }

          var total = rows.length;
          var display = rows.slice(0, ROW_LIMIT);

          meta.textContent = total > ROW_LIMIT
            ? 'Showing ' + ROW_LIMIT + ' of ' + total + ' rows'
            : total + ' rows';

          var table = document.createElement('table');
          table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;min-width:400px;';

          var thead = document.createElement('thead');
          var headRow = document.createElement('tr');
          var thRow = document.createElement('th');
          thRow.textContent = '_row';
          thRow.style.cssText = thStyle;
          headRow.appendChild(thRow);
          columns.forEach(function(c) {
            var th = document.createElement('th');
            th.textContent = c;
            th.style.cssText = thStyle;
            headRow.appendChild(th);
          });
          thead.appendChild(headRow);
          table.appendChild(thead);

          var tbody = document.createElement('tbody');
          display.forEach(function(row, idx) {
            var tr = document.createElement('tr');
            tr.style.cssText = 'transition:background 0.1s;';
            tr.onmouseenter = function() { this.style.background = 'rgba(108,99,255,0.04)'; };
            tr.onmouseleave = function() { this.style.background = ''; };
            var tdRow = document.createElement('td');
            tdRow.textContent = String(row._row);
            tdRow.style.cssText = tdStyle + 'color:#64748b;font-family:var(--mono);font-size:12px;';
            tr.appendChild(tdRow);
            columns.forEach(function(c) {
              var td = document.createElement('td');
              var val = row[c];
              td.textContent = val == null ? '' : String(val);
              td.style.cssText = tdStyle;
              tr.appendChild(td);
            });
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          container.appendChild(table);
        }

        var thStyle = 'text-align:left;padding:10px 14px;border-bottom:2px solid var(--border);color:#64748b;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;background:var(--surface);position:sticky;top:0;z-index:1;';
        var tdStyle = 'padding:10px 14px;border-bottom:1px solid #1e2132;color:var(--text);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

        // ── Loaders ─────────────────────────────────────────────────
        async function loadSchema() {
          try {
            var res = await fetch('/api/' + APP_ID + '/' + TABLE + '/schema');
            if (res.ok) {
              var data = await res.json();
              columns = data.columns || [];
              renderColumns();
            } else {
              columns = [];
              renderColumns();
            }
          } catch (err) {
            columns = [];
            renderColumns();
            showErrorBanner('schemaError', err.message || 'Failed to load schema');
          }
        }

        async function loadRows() {
          try {
            var res = await fetch('/api/' + APP_ID + '/' + TABLE);
            if (res.ok) {
              var data = await res.json();
              hideErrorBanner('rowsError');
              renderRows(data || []);
            } else {
              var err = await res.json().catch(function() { return { error: 'HTTP ' + res.status }; });
              showErrorBanner('rowsError', err.error || ('HTTP ' + res.status));
            }
          } catch (err) {
            showErrorBanner('rowsError', err.message || 'Network error');
          }
        }

        async function refreshAll() {
          await loadSchema();
          await loadRows();
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

        function init() {
          var hasAdmin = !!localStorage.getItem('gsdb_admin_secret');
          if (!hasAdmin && !getAppKey()) {
            showAppKey();
            return;
          }
          refreshAll();
        }

        init();
      ` }} />
  </Layout>
);

const containerStyle = {
  maxWidth: '1100px',
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

const tableTitleStyle = {
  fontSize: '28px',
  fontWeight: '800',
  letterSpacing: '-1px',
  fontFamily: 'var(--mono)',
  margin: '4px 0 0 0',
  color: 'var(--text)',
};

const taglineStyle = { color: 'var(--muted)', fontSize: '14px', marginTop: '8px' };
const endpointStyle = {
  color: 'var(--muted)',
  fontFamily: 'var(--mono)',
  fontSize: '12px',
  background: 'var(--surface)',
  padding: '4px 8px',
  borderRadius: '6px',
};

const headerActionsStyle = { display: 'flex', alignItems: 'center', gap: '8px' };

const keyBannerStyle = {
  background: 'rgba(108, 99, 255, 0.1)',
  border: '1px solid rgba(108, 99, 255, 0.3)',
  borderRadius: 'var(--radius)',
  padding: '12px 16px',
  color: '#c4b5fd',
  fontSize: '14px',
  display: 'none',
};

const sectionHeaderRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  marginBottom: '12px',
};

const mutedStyle = { color: '#64748b', fontSize: '13px' };

const columnsContainerStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: '8px',
  padding: '4px 0',
  minHeight: '32px',
};

const manageBarStyle = {
  display: 'none',
  gap: '8px',
  marginTop: '12px',
  alignItems: 'center' as const,
};

const addColumnInputStyle = {
  ...inputStyle,
  flex: 1,
};

const rowsWrapperStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'auto',
  WebkitOverflowScrolling: 'touch' as const,
};

const rowsContainerStyle = {};
