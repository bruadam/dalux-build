"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

const FALLBACK_BASE_URL = "https://node1.field.dalux.com/service/api/";
const HOURS = Array.from({ length: 24 }, (_, value) => value);
const MINUTES = Array.from({ length: 60 }, (_, value) => value);
const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const WEEKDAYS = [
  ["1", "Monday"],
  ["2", "Tuesday"],
  ["3", "Wednesday"],
  ["4", "Thursday"],
  ["5", "Friday"],
  ["6", "Saturday"],
  ["0", "Sunday"],
];

function padTime(value) {
  return String(value).padStart(2, "0");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  }
  return payload.data;
}

async function jobAction(url, method) {
  const response = await fetch(url, { method });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  }
  return payload.data;
}

function splitValues(value, { extensions = false } = {}) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (extensions ? item.replace(/^\./, "").toLowerCase() : item));
}

function buildFilenameFilter({
  contains,
  containsMatch,
  endsWith,
  extensions,
  notContains,
  startsWith,
}) {
  const filter = {
    contains: splitValues(contains),
    contains_match: containsMatch,
    not_contains: splitValues(notContains),
    startswith: splitValues(startsWith),
    endswith: splitValues(endsWith),
    extensions: splitValues(extensions, { extensions: true }),
  };
  for (const key of Object.keys(filter)) {
    if (Array.isArray(filter[key]) && filter[key].length === 0) delete filter[key];
  }
  return filter;
}

function matchesFilename(fileName, filter) {
  const value = fileName.toLowerCase();
  const lowered = (key) => (filter[key] || []).map((item) => item.toLowerCase());
  const contains = lowered("contains");
  if (contains.length) {
    const checks = contains.map((part) => value.includes(part));
    if (filter.contains_match === "all" ? !checks.every(Boolean) : !checks.some(Boolean)) {
      return false;
    }
  }
  if (lowered("not_contains").some((part) => value.includes(part))) return false;
  const starts = lowered("startswith");
  if (starts.length && !starts.some((part) => value.startsWith(part))) return false;
  const ends = lowered("endswith");
  if (ends.length && !ends.some((part) => value.endsWith(part))) return false;
  const extensions = lowered("extensions").map((part) =>
    part.startsWith(".") ? part : `.${part}`,
  );
  return !extensions.length || extensions.some((part) => value.endsWith(part));
}

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

function useFolderHierarchy(folders) {
  return useMemo(() => {
    const byId = new Set(folders.map((folder) => folder.folderId));
    const childMap = new Map();
    const parentMap = new Map();
    const rootItems = [];
    for (const folder of folders) {
      parentMap.set(folder.folderId, folder.parentFolderId);
      if (!folder.parentFolderId || !byId.has(folder.parentFolderId)) {
        rootItems.push(folder);
      } else {
        const items = childMap.get(folder.parentFolderId) || [];
        items.push(folder);
        childMap.set(folder.parentFolderId, items);
      }
    }
    const sort = (items) =>
      items.sort((a, b) => a.folderName.localeCompare(b.folderName));
    sort(rootItems);
    for (const items of childMap.values()) sort(items);
    return { roots: rootItems, children: childMap, parents: parentMap };
  }, [folders]);
}

function FolderTree({
  folders,
  mode,
  selectedId,
  onSelect,
  selectedIds,
  onToggle,
  searchQuery = "",
  emptyMessage = "No folders found.",
}) {
  const { roots, children, parents } = useFolderHierarchy(folders);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());

  useEffect(() => {
    setCollapsedIds(new Set());
  }, [folders]);

  function toggleCollapse(folderId) {
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  const query = searchQuery.trim().toLowerCase();
  const matchedIds = useMemo(() => {
    if (!query) return null;
    const visible = new Set();
    for (const folder of folders) {
      if (!folder.folderName.toLowerCase().includes(query)) continue;
      let current = folder.folderId;
      while (current && !visible.has(current)) {
        visible.add(current);
        current = parents.get(current);
      }
    }
    return visible;
  }, [folders, parents, query]);

  const render = (folder, depth = 0) => {
    const kids = (children.get(folder.folderId) || []).filter(
      (child) => !matchedIds || matchedIds.has(child.folderId),
    );
    const hasChildren = kids.length > 0;
    const expanded = matchedIds ? true : !collapsedIds.has(folder.folderId);
    return (
      <div key={folder.folderId}>
        <div className="tree-row" style={{ paddingLeft: `${depth * 16}px` }}>
          <button
            type="button"
            className="tree-toggle"
            disabled={!hasChildren}
            aria-label={expanded ? "Collapse folder" : "Expand folder"}
            onClick={() => toggleCollapse(folder.folderId)}
          >
            {hasChildren ? (expanded ? "▾" : "▸") : ""}
          </button>
          {mode === "nav" ? (
            <button
              type="button"
              className={`tree-item ${selectedId === folder.folderId ? "selected" : ""}`}
              onClick={() => onSelect(folder.folderId)}
            >
              <span>{folder.folderName}</span>
            </button>
          ) : (
            <label className="folder-check">
              <input
                type="checkbox"
                checked={selectedIds.has(folder.folderId)}
                onChange={() => onToggle(folder.folderId)}
              />
              <span>{folder.folderName}</span>
            </label>
          )}
        </div>
        {expanded && kids.map((child) => render(child, depth + 1))}
      </div>
    );
  };

  const visibleRoots = roots.filter(
    (folder) => !matchedIds || matchedIds.has(folder.folderId),
  );

  return (
    <>
      {visibleRoots.map((folder) => render(folder))}
      {!visibleRoots.length && (
        <Empty>{query ? "No folders match your search." : emptyMessage}</Empty>
      )}
    </>
  );
}

export default function RegistrationPage() {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(FALLBACK_BASE_URL);
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [fileAreas, setFileAreas] = useState([]);
  const [fileArea, setFileArea] = useState(null);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [selectedFileIds, setSelectedFileIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const [jobType, setJobType] = useState("change");
  const [scopeMode, setScopeMode] = useState("all");
  const [name, setName] = useState("");
  const [recurrence, setRecurrence] = useState("every15");
  const [scheduleHour, setScheduleHour] = useState("9");
  const [scheduleMinute, setScheduleMinute] = useState("0");
  const [scheduleWeekday, setScheduleWeekday] = useState("1");
  const [scheduleMonthDay, setScheduleMonthDay] = useState("1");
  const [customCron, setCustomCron] = useState("0 9 * * 1-5");
  const [timezone, setTimezone] = useState("Europe/Copenhagen");
  const [initialRun, setInitialRun] = useState("baseline");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [authType, setAuthType] = useState("none");
  const [callbackSecret, setCallbackSecret] = useState("");
  const [maxAgeDays, setMaxAgeDays] = useState("1");
  const [contains, setContains] = useState("");
  const [containsMatch, setContainsMatch] = useState("any");
  const [extensions, setExtensions] = useState("ifc");
  const [notContains, setNotContains] = useState("");
  const [startsWith, setStartsWith] = useState("");
  const [endsWith, setEndsWith] = useState("");
  const [freshnessFolderMode, setFreshnessFolderMode] = useState("all");
  const [selectedFolderIds, setSelectedFolderIds] = useState(new Set());
  const [folderSearch, setFolderSearch] = useState("");
  const [previewFingerprint, setPreviewFingerprint] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [jobMessage, setJobMessage] = useState("");

  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((config) => config.defaultBaseUrl && setBaseUrl(config.defaultBaseUrl))
      .catch(() => {});
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) setTimezone(detected);
  }, []);

  const credentials = { apiKey, baseUrl };
  const filteredProjects = projects.filter((item) =>
    `${item.projectName} ${item.number || ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  const visibleFiles = useMemo(() => {
    const selected =
      activeFolderId === "all"
        ? files
        : activeFolderId === "root"
          ? files.filter((file) => !file.folderId)
          : files.filter((file) => file.folderId === activeFolderId);
    return [...selected].sort((a, b) =>
      a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
    );
  }, [activeFolderId, files]);
  const freshnessFilter = useMemo(
    () =>
      buildFilenameFilter({
        contains,
        containsMatch,
        endsWith,
        extensions,
        notContains,
        startsWith,
      }),
    [contains, containsMatch, endsWith, extensions, notContains, startsWith],
  );
  const freshnessPreviewFiles = useMemo(() => {
    const candidates =
      freshnessFolderMode === "all"
        ? files
        : files.filter((file) => selectedFolderIds.has(file.folderId));
    return candidates
      .filter((file) => matchesFilename(file.fileName || "", freshnessFilter))
      .sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
  }, [files, freshnessFilter, freshnessFolderMode, selectedFolderIds]);
  const currentPreviewFingerprint = JSON.stringify({
    fileAreaId: fileArea?.fileAreaId,
    filter: freshnessFilter,
    folderIds:
      freshnessFolderMode === "all" ? [] : [...selectedFolderIds].sort(),
    maxAgeDays,
  });
  const previewIsCurrent = previewFingerprint === currentPreviewFingerprint;
  const cron = useMemo(() => {
    if (recurrence === "every15") return "*/15 * * * *";
    if (recurrence === "hourly") return `${scheduleMinute} * * * *`;
    if (recurrence === "daily") return `${scheduleMinute} ${scheduleHour} * * *`;
    if (recurrence === "weekly") {
      return `${scheduleMinute} ${scheduleHour} * * ${scheduleWeekday}`;
    }
    if (recurrence === "monthly") {
      return `${scheduleMinute} ${scheduleHour} ${scheduleMonthDay} * *`;
    }
    return customCron.trim();
  }, [
    customCron,
    recurrence,
    scheduleHour,
    scheduleMinute,
    scheduleMonthDay,
    scheduleWeekday,
  ]);

  async function connect(event) {
    event.preventDefault();
    setBusy("projects");
    setError("");
    setResult(null);
    try {
      const data = await postJson("/api/dalux", {
        action: "projects",
        ...credentials,
      });
      setProjects(data);
      setConnected(true);
      setProject(null);
      setFileArea(null);
      setFileAreas([]);
      setFiles([]);
      setFolders([]);
      setSelectedFolderIds(new Set());
      setFolderSearch("");
      setPreviewFingerprint("");
    } catch (err) {
      setConnected(false);
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function chooseProject(item) {
    setProject(item);
    setFileArea(null);
    setFiles([]);
    setFolders([]);
    setSelectedFolderIds(new Set());
    setFolderSearch("");
    setPreviewFingerprint("");
    setBusy("fileAreas");
    setError("");
    try {
      setFileAreas(
        await postJson("/api/dalux", {
          action: "fileAreas",
          projectId: item.projectId,
          ...credentials,
        }),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function chooseFileArea(item) {
    setFileArea(item);
    setBusy("catalog");
    setError("");
    setSelectedFileIds(new Set());
    setSelectedFolderIds(new Set());
    setFolderSearch("");
    setPreviewFingerprint("");
    setActiveFolderId("all");
    try {
      const catalog = await postJson("/api/dalux", {
        action: "catalog",
        projectId: project.projectId,
        fileAreaId: item.fileAreaId,
        ...credentials,
      });
      setFolders(catalog.folders || []);
      setFiles(catalog.files || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function toggleFile(fileId) {
    setSelectedFileIds((previous) => {
      const next = new Set(previous);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  function toggleVisible() {
    const ids = visibleFiles.map((file) => file.fileId);
    const allSelected = ids.length > 0 && ids.every((id) => selectedFileIds.has(id));
    setSelectedFileIds((previous) => {
      const next = new Set(previous);
      for (const id of ids) allSelected ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleFolder(folderId) {
    setSelectedFolderIds((previous) => {
      const next = new Set(previous);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function previewFreshness() {
    setError("");
    if (freshnessFolderMode === "folderIds" && selectedFolderIds.size === 0) {
      setError("Select at least one folder, or use all folders.");
      return;
    }
    if (Object.keys(freshnessFilter).every((key) => key === "contains_match")) {
      setError("Add at least one filename filter for a freshness monitor.");
      return;
    }
    setPreviewFingerprint(currentPreviewFingerprint);
  }

  async function testJob() {
    setBusy("test");
    setError("");
    setTestResult(null);
    try {
      setTestResult(await jobAction(`/api/jobs/${encodeURIComponent(result.jobId)}`, "POST"));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function deleteJob() {
    if (!window.confirm(`Delete job ${result.jobId}? This also removes its saved state.`)) return;
    setBusy("delete");
    setError("");
    try {
      const jobId = result.jobId;
      await jobAction(`/api/jobs/${encodeURIComponent(jobId)}`, "DELETE");
      setResult(null);
      setTestResult(null);
      setJobMessage(`Job ${jobId} was deleted.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function register(event) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (!project || !fileArea) {
      setError("Choose a project and file area first.");
      return;
    }
    if (jobType === "change" && scopeMode === "fileIds" && selectedFileIds.size === 0) {
      setError("Select at least one file, or monitor the whole file area.");
      return;
    }
    if (jobType === "freshness" && !previewIsCurrent) {
      setError("Preview the matching files before configuring delivery.");
      return;
    }

    const callback = { url: callbackUrl, authType };
    if (authType !== "none") callback.secret = callbackSecret;
    const common = {
      name: name.trim() || null,
      projectId: project.projectId,
      fileAreaId: fileArea.fileAreaId,
      daluxApiKey: apiKey,
      daluxBaseUrl: baseUrl,
      cron,
      timezone,
      callback,
    };
    const job =
      jobType === "change"
        ? {
            ...common,
            scope: {
              mode: scopeMode,
              fileIds: scopeMode === "fileIds" ? [...selectedFileIds] : [],
            },
            initialRun,
          }
        : {
            ...common,
            folderIds:
              freshnessFolderMode === "folderIds" ? [...selectedFolderIds] : [],
            fileNameFilter: freshnessFilter,
            maxAge: `P${Number(maxAgeDays)}D`,
          };

    setBusy("register");
    try {
      const data = await postJson("/api/jobs", { jobType, job });
      setResult(data);
      setTestResult(null);
      setJobMessage("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <main>
      <header className="hero">
        <div className="brand-mark" aria-hidden="true">D</div>
        <div>
          <p className="eyebrow">Dalux Build · scheduled monitor</p>
          <h1>Register a file webhook</h1>
          <p className="intro">
            Choose what to watch, then send change or freshness events to an n8n POST webhook.
          </p>
        </div>
      </header>

      <ol className="steps" aria-label="Registration progress">
        <li className="active"><span>1</span>Connect</li>
        <li className={connected ? "active" : ""}><span>2</span>Project</li>
        <li className={fileArea ? "active" : ""}><span>3</span>Scope</li>
        <li className={fileArea && (jobType !== "freshness" || previewIsCurrent) ? "active" : ""}><span>4</span>Delivery</li>
      </ol>

      {error && <div className="notice error" role="alert"><strong>Couldn’t continue.</strong> {error}</div>}
      {result && (
        <div className="notice success" role="status">
          <div><strong>Webhook registered.</strong> The monitor is scheduled and ready.</div>
          <dl>
            <div><dt>Job ID</dt><dd>{result.jobId}</dd></div>
            <div><dt>Next run</dt><dd>{new Date(result.nextRunAt).toLocaleString()}</dd></div>
          </dl>
          <div className="job-actions">
            <button type="button" className="button secondary" onClick={testJob} disabled={busy === "test" || busy === "delete"}>
              {busy === "test" && <Spinner />} Send test webhook
            </button>
            <button type="button" className="button danger" onClick={deleteJob} disabled={busy === "test" || busy === "delete"}>
              {busy === "delete" && <Spinner />} Delete job
            </button>
          </div>
          {testResult && (
            <p className="action-result">
              Test delivered successfully (HTTP {testResult.statusCode}, delivery {testResult.deliveryId}).
            </p>
          )}
        </div>
      )}
      {jobMessage && <div className="notice success" role="status">{jobMessage}</div>}

      <section className="card connection-card">
        <div className="section-heading">
          <div><span className="section-number">01</span><h2>Dalux connection</h2></div>
          {connected && <span className="status-pill">Connected</span>}
        </div>
        <form className="connection-grid" onSubmit={connect}>
          <Field label="DALUX_API_KEY" hint="Used only for catalog browsing and encrypted when the job is saved.">
            <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required placeholder="Paste your Dalux API key" />
          </Field>
          <Field label="Base URL" hint="Change this only when your Dalux environment uses another API host.">
            <input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
          </Field>
          <button className="button primary connect-button" disabled={busy === "projects"}>
            {busy === "projects" && <Spinner />} {connected ? "Reconnect" : "Connect & load projects"}
          </button>
        </form>
      </section>

      {connected && (
        <section className="card">
          <div className="section-heading">
            <div><span className="section-number">02</span><h2>Project and file area</h2></div>
            {project && fileArea && <span className="selection-summary">{project.projectName} / {fileArea.fileAreaName}</span>}
          </div>
          <div className="browser-columns">
            <div className="browser-panel">
              <div className="panel-title"><h3>Projects</h3><span>{projects.length}</span></div>
              <input className="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects…" />
              <div className="entity-list">
                {filteredProjects.map((item) => (
                  <button type="button" key={item.projectId} className={`entity ${project?.projectId === item.projectId ? "selected" : ""}`} onClick={() => chooseProject(item)}>
                    <span className="entity-icon">P</span><span><strong>{item.projectName}</strong><small>{item.number || item.projectId}</small></span><span className="chevron">›</span>
                  </button>
                ))}
                {!filteredProjects.length && <Empty>No projects found.</Empty>}
              </div>
            </div>
            <div className="browser-panel">
              <div className="panel-title"><h3>File areas</h3><span>{fileAreas.length}</span></div>
              <div className="entity-list tall">
                {busy === "fileAreas" && <Empty><Spinner /> Loading file areas…</Empty>}
                {busy !== "fileAreas" && !project && <Empty>Select a project to continue.</Empty>}
                {busy !== "fileAreas" && project && fileAreas.map((item) => (
                  <button type="button" key={item.fileAreaId} className={`entity ${fileArea?.fileAreaId === item.fileAreaId ? "selected" : ""}`} onClick={() => chooseFileArea(item)}>
                    <span className="entity-icon folder">F</span><span><strong>{item.fileAreaName}</strong><small>{item.fileAreaType}</small></span><span className="chevron">›</span>
                  </button>
                ))}
                {busy !== "fileAreas" && project && !fileAreas.length && <Empty>No file areas found.</Empty>}
              </div>
            </div>
          </div>
        </section>
      )}

      {fileArea && (
        <form onSubmit={register}>
          <section className="card">
            <div className="section-heading">
              <div><span className="section-number">03</span><h2>Monitor method and scope</h2></div>
            </div>
            <div className="method-toggle">
              <button type="button" className={jobType === "change" ? "selected" : ""} onClick={() => setJobType("change")}><strong>Change monitor</strong><span>Notify when files are added, modified, or deleted.</span></button>
              <button type="button" className={jobType === "freshness" ? "selected" : ""} onClick={() => setJobType("freshness")}><strong>Freshness monitor</strong><span>Report whether matching files are within a maximum age.</span></button>
            </div>

            {busy === "catalog" ? <Empty><Spinner /> Loading folders and files…</Empty> : jobType === "change" ? (
              <>
                <div className="scope-options">
                  <label><input type="radio" name="scope" checked={scopeMode === "all"} onChange={() => setScopeMode("all")} /><span><strong>Entire file area</strong><small>Watch all current and future files.</small></span></label>
                  <label><input type="radio" name="scope" checked={scopeMode === "fileIds"} onChange={() => setScopeMode("fileIds")} /><span><strong>Selected files</strong><small>Choose files from one or more folders.</small></span></label>
                </div>
                {scopeMode === "fileIds" && (
                  <div className="file-browser">
                    <aside>
                      <div className="tree-row">
                        <span className="tree-toggle" aria-hidden="true" />
                        <button type="button" className={`tree-item ${activeFolderId === "all" ? "selected" : ""}`} onClick={() => setActiveFolderId("all")}>▦ All files</button>
                      </div>
                      <div className="tree-row">
                        <span className="tree-toggle" aria-hidden="true" />
                        <button type="button" className={`tree-item ${activeFolderId === "root" ? "selected" : ""}`} onClick={() => setActiveFolderId("root")}>⌂ File-area root</button>
                      </div>
                      <FolderTree folders={folders} mode="nav" selectedId={activeFolderId} onSelect={setActiveFolderId} />
                    </aside>
                    <div className="files-panel">
                      <div className="files-toolbar"><span><strong>{selectedFileIds.size}</strong> selected</span><button type="button" onClick={toggleVisible}>{visibleFiles.every((file) => selectedFileIds.has(file.fileId)) && visibleFiles.length ? "Clear visible" : "Select visible"}</button></div>
                      <div className="files-list">
                        {visibleFiles.map((file) => (
                          <label className="file-row" key={file.fileId}><input type="checkbox" checked={selectedFileIds.has(file.fileId)} onChange={() => toggleFile(file.fileId)} /><span className="file-type">{(file.fileName.split(".").pop() || "file").slice(0, 4)}</span><span><strong>{file.fileName}</strong><small>{file.lastModified ? `Modified ${file.lastModified}` : file.fileId}</small></span></label>
                        ))}
                        {!visibleFiles.length && <Empty>No files in this folder.</Empty>}
                      </div>
                    </div>
                  </div>
                )}
                <div className="inline-fields">
                  <Field label="First run"><select value={initialRun} onChange={(e) => setInitialRun(e.target.value)}><option value="baseline">Create baseline silently</option><option value="emitCurrent">Emit current files</option></select></Field>
                </div>
              </>
            ) : (
              <div className="filters">
                <p className="helper">Choose the folders to check, apply filename rules, then preview the exact matching files.</p>
                <div className="scope-options">
                  <label><input type="radio" name="freshness-scope" checked={freshnessFolderMode === "all"} onChange={() => setFreshnessFolderMode("all")} /><span><strong>All folders</strong><small>Include files throughout the file area.</small></span></label>
                  <label><input type="radio" name="freshness-scope" checked={freshnessFolderMode === "folderIds"} onChange={() => setFreshnessFolderMode("folderIds")} /><span><strong>Selected folders</strong><small>Apply filters only inside the folders you choose.</small></span></label>
                </div>
                {freshnessFolderMode === "folderIds" && (
                  <div className="folder-picker">
                    <input
                      className="search"
                      type="search"
                      value={folderSearch}
                      onChange={(e) => setFolderSearch(e.target.value)}
                      placeholder="Search folders…"
                    />
                    <div className="files-toolbar">
                      <span><strong>{selectedFolderIds.size}</strong> folders selected</span>
                      {selectedFolderIds.size > 0 && <button type="button" onClick={() => setSelectedFolderIds(new Set())}>Clear selection</button>}
                    </div>
                    <div className="folder-list">
                      <FolderTree
                        folders={folders}
                        mode="check"
                        selectedIds={selectedFolderIds}
                        onToggle={toggleFolder}
                        searchQuery={folderSearch}
                        emptyMessage="No folders found in this file area."
                      />
                    </div>
                  </div>
                )}
                <div className="form-grid two">
                  <Field label="Extensions" hint="Comma-separated, with or without a dot."><input value={extensions} onChange={(e) => setExtensions(e.target.value)} placeholder="ifc, pdf" /></Field>
                  <Field label="Name contains"><input value={contains} onChange={(e) => setContains(e.target.value)} placeholder="coordination, model" /></Field>
                  <Field label="Contains matching"><select value={containsMatch} onChange={(e) => setContainsMatch(e.target.value)}><option value="any">Match any value</option><option value="all">Match all values</option></select></Field>
                  <Field label="Name does not contain"><input value={notContains} onChange={(e) => setNotContains(e.target.value)} placeholder="archive, old" /></Field>
                  <Field label="Name starts with"><input value={startsWith} onChange={(e) => setStartsWith(e.target.value)} placeholder="C07_" /></Field>
                  <Field label="Name ends with"><input value={endsWith} onChange={(e) => setEndsWith(e.target.value)} placeholder="_approved.ifc" /></Field>
                  <Field label="Maximum age (whole days)"><input type="number" min="1" step="1" required value={maxAgeDays} onChange={(e) => setMaxAgeDays(e.target.value)} /></Field>
                </div>
                <div className="preview-controls">
                  <div>
                    <strong>Preview matching files</strong>
                    <span>Required before schedule and delivery settings are shown.</span>
                  </div>
                  <button type="button" className="button secondary" onClick={previewFreshness}>Run preview</button>
                </div>
                {previewIsCurrent && (
                  <div className="preview-panel">
                    <div className="files-toolbar"><span><strong>{freshnessPreviewFiles.length}</strong> matching files</span></div>
                    <div className="preview-list">
                      {freshnessPreviewFiles.map((file) => (
                        <div className="file-row preview-row" key={file.fileId}>
                          <span className="file-type">{(file.fileName.split(".").pop() || "file").slice(0, 4)}</span>
                          <span><strong>{file.fileName}</strong><small>{file.lastModified ? `Modified ${file.lastModified}` : "No modified date"}</small></span>
                        </div>
                      ))}
                      {!freshnessPreviewFiles.length && <Empty>No files match this folder scope and filter.</Empty>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {(jobType !== "freshness" || previewIsCurrent) && <section className="card">
            <div className="section-heading"><div><span className="section-number">04</span><h2>Schedule and n8n delivery</h2></div></div>
            <div className="schedule-builder">
              <Field label="Recurrence">
                <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                  <option value="every15">Every 15 minutes</option>
                  <option value="hourly">Every hour</option>
                  <option value="daily">Once a day</option>
                  <option value="weekly">Once a week</option>
                  <option value="monthly">Once a month</option>
                  <option value="custom">Custom cron expression</option>
                </select>
              </Field>

              {recurrence === "weekly" && (
                <Field label="Day of week">
                  <select value={scheduleWeekday} onChange={(e) => setScheduleWeekday(e.target.value)}>
                    {WEEKDAYS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
              )}
              {recurrence === "monthly" && (
                <Field label="Day of month" hint="Months without this day are skipped.">
                  <select value={scheduleMonthDay} onChange={(e) => setScheduleMonthDay(e.target.value)}>
                    {MONTH_DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
                  </select>
                </Field>
              )}
              {["daily", "weekly", "monthly"].includes(recurrence) && (
                <Field label="Hour">
                  <select value={scheduleHour} onChange={(e) => setScheduleHour(e.target.value)}>
                    {HOURS.map((hour) => <option key={hour} value={hour}>{padTime(hour)}</option>)}
                  </select>
                </Field>
              )}
              {["hourly", "daily", "weekly", "monthly"].includes(recurrence) && (
                <Field label="Minute">
                  <select value={scheduleMinute} onChange={(e) => setScheduleMinute(e.target.value)}>
                    {MINUTES.map((minute) => <option key={minute} value={minute}>{padTime(minute)}</option>)}
                  </select>
                </Field>
              )}
              {recurrence === "custom" && (
                <Field label="Cron expression">
                  <input value={customCron} onChange={(e) => setCustomCron(e.target.value)} required placeholder="0 9 * * 1-5" />
                </Field>
              )}
              <div className="cron-preview"><span>Schedule sent to monitor</span><code>{cron}</code></div>
            </div>
            <div className="form-grid two">
              <Field label="Job name" hint="Optional label for your own reference."><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Coordination models" /></Field>
              <Field label="Timezone"><input value={timezone} onChange={(e) => setTimezone(e.target.value)} required placeholder="Europe/Copenhagen" /></Field>
              <Field label="n8n POST URL" hint="Use the production URL of an active n8n Webhook node."><input type="url" value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} required placeholder="https://n8n.example/webhook/dalux" /></Field>
              <Field label="Callback authentication"><select value={authType} onChange={(e) => setAuthType(e.target.value)}><option value="none">No authentication</option><option value="bearer">Bearer token</option><option value="hmac-sha256">HMAC SHA-256 signature</option></select></Field>
              {authType !== "none" && <Field label={authType === "bearer" ? "Bearer token" : "HMAC secret"}><input type="password" autoComplete="new-password" value={callbackSecret} onChange={(e) => setCallbackSecret(e.target.value)} required /></Field>}
            </div>
            <details className="n8n-help">
              <summary>Where do I find the n8n POST URL?</summary>
              <div className="n8n-help-content">
                <div>
                  <strong>Configure the n8n Webhook node</strong>
                  <ol>
                    <li>Set the HTTP Method to <code>POST</code>.</li>
                    <li>Open the Production URL tab and copy the displayed URL.</li>
                    <li>Paste it into the n8n POST URL field above and activate the workflow.</li>
                  </ol>
                </div>
                <Image
                  src="/n8n-webhook-help.png"
                  width={1667}
                  height={944}
                  sizes="(max-width: 1120px) 100vw, 1068px"
                  alt="Annotated n8n Webhook node showing where to select POST and copy the production URL"
                />
              </div>
            </details>
            <div className="submit-row">
              <p>The Dalux key and callback secret are encrypted before storage.</p>
              <button className="button primary" disabled={busy === "register" || busy === "catalog"}>{busy === "register" && <Spinner />} Register {jobType} webhook</button>
            </div>
          </section>}
        </form>
      )}
      <footer>Dalux Scheduled Monitor · credentials are never stored in this browser</footer>
    </main>
  );
}
