"use client";

import { useEffect, useMemo, useState } from "react";

import { ConnectionStep } from "@/components/wizard/connection-step";
import { JobNotices } from "@/components/wizard/job-notices";
import { MonitorScopeStep } from "@/components/wizard/monitor-scope-step";
import { ProjectFileAreaStep } from "@/components/wizard/project-file-area-step";
import { ScheduleStep } from "@/components/wizard/schedule-step";
import { WizardStepper } from "@/components/wizard/wizard-stepper";
import { FALLBACK_BASE_URL } from "@/lib/wizard/constants";
import { buildFilenameFilter, jobAction, matchesFilename, postJson } from "@/lib/wizard/utils";

export function RegistrationWizard() {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(FALLBACK_BASE_URL);
  const [savedCredentials, setSavedCredentials] = useState([]);
  const [credentialMode, setCredentialMode] = useState("new");
  const [credentialName, setCredentialName] = useState("");
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
  const [testCallbackUrl, setTestCallbackUrl] = useState("");
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

  function loadSavedCredentials() {
    fetch("/api/credentials", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (payload?.ok) setSavedCredentials(payload.data || []);
      })
      .catch(() => {});
  }

  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((config) => config.defaultBaseUrl && setBaseUrl(config.defaultBaseUrl))
      .catch(() => {});
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) setTimezone(detected);
    loadSavedCredentials();
  }, []);

  const credentialParams =
    credentialMode === "new" ? { apiKey, baseUrl } : { credentialId: credentialMode };
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
    folderIds: freshnessFolderMode === "all" ? [] : [...selectedFolderIds].sort(),
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
  }, [customCron, recurrence, scheduleHour, scheduleMinute, scheduleMonthDay, scheduleWeekday]);

  async function connect(event) {
    event.preventDefault();
    setBusy("projects");
    setError("");
    setResult(null);
    try {
      const data = await postJson("/api/dalux", {
        action: "projects",
        ...credentialParams,
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
          ...credentialParams,
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
        ...credentialParams,
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
    const testCallback = testCallbackUrl.trim()
      ? { url: testCallbackUrl.trim(), authType, ...(authType !== "none" ? { secret: callbackSecret } : {}) }
      : undefined;
    const common = {
      name: name.trim() || null,
      projectId: project.projectId,
      fileAreaId: fileArea.fileAreaId,
      ...(credentialMode === "new"
        ? {
            daluxApiKey: apiKey,
            daluxBaseUrl: baseUrl,
            credentialName: credentialName.trim() || null,
          }
        : { credentialId: credentialMode }),
      cron,
      timezone,
      callback,
      ...(testCallback ? { testCallback } : {}),
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
            folderIds: freshnessFolderMode === "folderIds" ? [...selectedFolderIds] : [],
            fileNameFilter: freshnessFilter,
            maxAge: `P${Number(maxAgeDays)}D`,
          };

    setBusy("register");
    try {
      const data = await postJson("/api/jobs", { jobType, job });
      setResult(data);
      setTestResult(null);
      setJobMessage("");
      if (credentialMode === "new") loadSavedCredentials();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const deliveryReady = jobType !== "freshness" || previewIsCurrent;

  return (
    <div className="mx-auto w-full max-w-5xl pb-8">
      <WizardStepper connected={connected} fileArea={fileArea} deliveryReady={deliveryReady} />

      <JobNotices
        error={error}
        result={result}
        testResult={testResult}
        jobMessage={jobMessage}
        busy={busy}
        onTestJob={testJob}
        onDeleteJob={deleteJob}
      />

      <ConnectionStep
        savedCredentials={savedCredentials}
        credentialMode={credentialMode}
        setCredentialMode={setCredentialMode}
        credentialName={credentialName}
        setCredentialName={setCredentialName}
        apiKey={apiKey}
        setApiKey={setApiKey}
        baseUrl={baseUrl}
        setBaseUrl={setBaseUrl}
        connected={connected}
        busy={busy}
        onConnect={connect}
      />

      {connected && (
        <ProjectFileAreaStep
          projects={projects}
          project={project}
          fileAreas={fileAreas}
          fileArea={fileArea}
          search={search}
          setSearch={setSearch}
          busy={busy}
          onChooseProject={chooseProject}
          onChooseFileArea={chooseFileArea}
        />
      )}

      {fileArea && (
        <form onSubmit={register}>
          <MonitorScopeStep
            busy={busy}
            jobType={jobType}
            setJobType={setJobType}
            folders={folders}
            scopeMode={scopeMode}
            setScopeMode={setScopeMode}
            activeFolderId={activeFolderId}
            setActiveFolderId={setActiveFolderId}
            selectedFileIds={selectedFileIds}
            toggleFile={toggleFile}
            toggleVisible={toggleVisible}
            visibleFiles={visibleFiles}
            initialRun={initialRun}
            setInitialRun={setInitialRun}
            freshnessFolderMode={freshnessFolderMode}
            setFreshnessFolderMode={setFreshnessFolderMode}
            selectedFolderIds={selectedFolderIds}
            toggleFolder={toggleFolder}
            setSelectedFolderIds={setSelectedFolderIds}
            folderSearch={folderSearch}
            setFolderSearch={setFolderSearch}
            extensions={extensions}
            setExtensions={setExtensions}
            contains={contains}
            setContains={setContains}
            containsMatch={containsMatch}
            setContainsMatch={setContainsMatch}
            notContains={notContains}
            setNotContains={setNotContains}
            startsWith={startsWith}
            setStartsWith={setStartsWith}
            endsWith={endsWith}
            setEndsWith={setEndsWith}
            maxAgeDays={maxAgeDays}
            setMaxAgeDays={setMaxAgeDays}
            onPreviewFreshness={previewFreshness}
            previewIsCurrent={previewIsCurrent}
            freshnessPreviewFiles={freshnessPreviewFiles}
          />

          {deliveryReady && (
            <ScheduleStep
              jobType={jobType}
              recurrence={recurrence}
              setRecurrence={setRecurrence}
              scheduleWeekday={scheduleWeekday}
              setScheduleWeekday={setScheduleWeekday}
              scheduleMonthDay={scheduleMonthDay}
              setScheduleMonthDay={setScheduleMonthDay}
              scheduleHour={scheduleHour}
              setScheduleHour={setScheduleHour}
              scheduleMinute={scheduleMinute}
              setScheduleMinute={setScheduleMinute}
              customCron={customCron}
              setCustomCron={setCustomCron}
              cron={cron}
              name={name}
              setName={setName}
              timezone={timezone}
              setTimezone={setTimezone}
              callbackUrl={callbackUrl}
              setCallbackUrl={setCallbackUrl}
              testCallbackUrl={testCallbackUrl}
              setTestCallbackUrl={setTestCallbackUrl}
              authType={authType}
              setAuthType={setAuthType}
              callbackSecret={callbackSecret}
              setCallbackSecret={setCallbackSecret}
              busy={busy}
            />
          )}
        </form>
      )}

      <footer className="pt-2 text-center text-xs text-muted-foreground">
        Dalux Scheduled Monitor · credentials are stored server-side only, never in this browser
      </footer>
    </div>
  );
}
