'use client';

import { useEffect, useMemo, useState } from 'react';
import { catalog } from '../lib/catalog';

const LS_CREDS = 'dalux_pg_creds';
const LS_PARAMS = 'dalux_pg_params';

// Minimal JSON syntax highlighter -> HTML string.
function highlightJson(value) {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) return String(value);
  const esc = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'tok-num';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'tok-key' : 'tok-str';
      } else if (/true|false/.test(match)) {
        cls = 'tok-bool';
      } else if (/null/.test(match)) {
        cls = 'tok-null';
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

export default function Home() {
  const groups = useMemo(() => Object.entries(catalog), []);

  const [selected, setSelected] = useState(() => {
    const firstRes = Object.keys(catalog)[0];
    const firstMethod = Object.keys(catalog[firstRes].methods)[0];
    return { resource: firstRes, method: firstMethod };
  });

  const [creds, setCreds] = useState({ baseUrl: '', apiKey: '' });
  const [hasServerKey, setHasServerKey] = useState(false);
  const [paramStore, setParamStore] = useState({}); // { "resource.method.paramName": value }
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Load persisted creds + params, then fetch server defaults.
  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem(LS_CREDS) || 'null');
      if (c) setCreds((prev) => ({ ...prev, ...c }));
      const p = JSON.parse(localStorage.getItem(LS_PARAMS) || 'null');
      if (p) setParamStore(p);
    } catch {}

    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        setHasServerKey(Boolean(cfg.hasServerKey));
        setCreds((prev) => ({ ...prev, baseUrl: prev.baseUrl || cfg.baseUrl || '' }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_CREDS, JSON.stringify(creds));
  }, [creds]);
  useEffect(() => {
    localStorage.setItem(LS_PARAMS, JSON.stringify(paramStore));
  }, [paramStore]);

  const methodSpec = catalog[selected.resource].methods[selected.method];

  function paramKey(name) {
    return `${selected.resource}.${selected.method}.${name}`;
  }
  function getParam(name) {
    return paramStore[paramKey(name)] ?? '';
  }
  function setParam(name, value) {
    setParamStore((prev) => ({ ...prev, [paramKey(name)]: value }));
  }

  async function run() {
    setLoading(true);
    setResult(null);
    const params = {};
    for (const spec of methodSpec.params) params[spec.name] = getParam(spec.name);
    const started = Date.now();
    try {
      const res = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: selected.resource,
          method: selected.method,
          params,
          credentials: creds,
        }),
      });
      const body = await res.json();
      setResult({ ...body, httpStatus: res.status, clientMs: Date.now() - started });
    } catch (e) {
      setResult({ ok: false, error: { message: e.message }, clientMs: Date.now() - started });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Dalux Build API</h1>
        <span className="tag">Playground</span>
        <div className="spacer" />
        <span className="hint">Calls run server-side via the local client</span>
      </header>

      <nav className="sidebar">
        {groups.map(([resKey, res]) => (
          <div key={resKey}>
            <div className="group-label">{res.label}</div>
            {Object.entries(res.methods).map(([mKey, m]) => {
              const active = selected.resource === resKey && selected.method === mKey;
              return (
                <button
                  key={mKey}
                  className={`method${active ? ' active' : ''}`}
                  onClick={() => {
                    setSelected({ resource: resKey, method: mKey });
                    setResult(null);
                  }}
                >
                  <span className={`verb ${m.http}`}>{m.http}</span>
                  {mKey}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <main className="main">
        <div className="settings">
          <div className="field grow">
            <label>Base URL</label>
            <input
              value={creds.baseUrl}
              onChange={(e) => setCreds((p) => ({ ...p, baseUrl: e.target.value }))}
              placeholder="https://node1.field.dalux.com/service/api/"
            />
          </div>
          <div className="field grow">
            <label>
              API Key{' '}
              {hasServerKey && <span className="pill ok">server default available</span>}
            </label>
            <input
              type="password"
              value={creds.apiKey}
              onChange={(e) => setCreds((p) => ({ ...p, apiKey: e.target.value }))}
              placeholder={hasServerKey ? 'leave blank to use server .env.local' : 'X-API-KEY'}
            />
          </div>
        </div>

        <div className="method-header">
          <span className={`verb ${methodSpec.http}`}>{methodSpec.http}</span>
          <h2>
            {selected.resource}.{selected.method}
          </h2>
          {methodSpec.write && <span className="warn-write">⚠ mutating</span>}
        </div>
        <p className="method-desc">{methodSpec.desc}</p>

        <div className="params">
          {methodSpec.params.length === 0 && (
            <div className="hint">No parameters.</div>
          )}
          {methodSpec.params.map((spec) => (
            <div className="param-row" key={spec.name}>
              <div>
                <span className="name">{spec.label || spec.name}</span>
                {spec.required ? <span className="req">*</span> : <span className="opt">optional</span>}
              </div>
              {spec.type === 'json' ? (
                <textarea
                  value={getParam(spec.name)}
                  onChange={(e) => setParam(spec.name, e.target.value)}
                  placeholder={spec.placeholder || '{ }'}
                />
              ) : (
                <input
                  value={getParam(spec.name)}
                  onChange={(e) => setParam(spec.name, e.target.value)}
                  placeholder={spec.placeholder || ''}
                />
              )}
            </div>
          ))}
        </div>

        <div className="actions">
          <button className="run" onClick={run} disabled={loading}>
            {loading ? 'Running…' : 'Send request'}
          </button>
          {methodSpec.write && (
            <span className="warn-write">This performs a real write against the API.</span>
          )}
        </div>

        {result && (
          <div className="response">
            <div className="response-bar">
              <span className={`status ${result.ok ? 'ok' : 'err'}`}>
                {result.ok ? '● Success' : `● ${result.error?.name || 'Error'}`}
              </span>
              <span className="meta">
                {(result.meta?.durationMs ?? result.clientMs)}ms
                {result.meta?.http ? ` · ${result.meta.http}` : ''}
              </span>
            </div>
            <pre
              className="json"
              dangerouslySetInnerHTML={{
                __html: highlightJson(result.ok ? result.data : result.error),
              }}
            />
          </div>
        )}

        {!result && <div className="empty">Fill in the parameters and send a request to see the response.</div>}
      </main>
    </div>
  );
}
