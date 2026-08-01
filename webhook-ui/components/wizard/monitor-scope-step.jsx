"use client";

import { CircleNotchIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Empty, FolderTree } from "@/components/wizard/folder-tree";
import { cn } from "@/lib/utils";

function MethodOption({ id, value, active, title, description }) {
  return (
    <Label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-lg border p-4 font-normal",
        active && "border-primary bg-primary/5 ring-1 ring-primary",
      )}
    >
      <RadioGroupItem value={value} id={id} className="sr-only" />
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </Label>
  );
}

function PlainOption({ id, value, title, description }) {
  return (
    <Label htmlFor={id} className="flex cursor-pointer items-start gap-2 font-normal">
      <RadioGroupItem value={value} id={id} className="mt-1" />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </Label>
  );
}

function fileExt(fileName) {
  return (fileName.split(".").pop() || "file").slice(0, 4);
}

export function MonitorScopeStep({
  busy,
  jobType,
  setJobType,
  folders,
  scopeMode,
  setScopeMode,
  activeFolderId,
  setActiveFolderId,
  selectedFileIds,
  toggleFile,
  toggleVisible,
  visibleFiles,
  initialRun,
  setInitialRun,
  freshnessFolderMode,
  setFreshnessFolderMode,
  selectedFolderIds,
  toggleFolder,
  setSelectedFolderIds,
  folderSearch,
  setFolderSearch,
  extensions,
  setExtensions,
  contains,
  setContains,
  containsMatch,
  setContainsMatch,
  notContains,
  setNotContains,
  startsWith,
  setStartsWith,
  endsWith,
  setEndsWith,
  maxAgeDays,
  setMaxAgeDays,
  onPreviewFreshness,
  previewIsCurrent,
  freshnessPreviewFiles,
}) {
  const allVisibleSelected =
    visibleFiles.length > 0 && visibleFiles.every((file) => selectedFileIds.has(file.fileId));

  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="text-xs font-extrabold tracking-wide text-primary">03</span>
          <CardTitle>Monitor method and scope</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={jobType}
          onValueChange={setJobType}
          className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <MethodOption
            id="jobType-change"
            value="change"
            active={jobType === "change"}
            title="Change monitor"
            description="Notify when files are added, modified, or deleted."
          />
          <MethodOption
            id="jobType-freshness"
            value="freshness"
            active={jobType === "freshness"}
            title="Freshness monitor"
            description="Report whether matching files are within a maximum age."
          />
        </RadioGroup>

        {busy === "catalog" ? (
          <Empty>
            <CircleNotchIcon className="size-4 animate-spin" /> Loading folders and files…
          </Empty>
        ) : jobType === "change" ? (
          <>
            <RadioGroup
              value={scopeMode}
              onValueChange={setScopeMode}
              className="mb-5 flex flex-col gap-3 sm:flex-row sm:gap-6"
            >
              <PlainOption
                id="scopeMode-all"
                value="all"
                title="Entire file area"
                description="Watch all current and future files."
              />
              <PlainOption
                id="scopeMode-fileIds"
                value="fileIds"
                title="Selected files"
                description="Choose files from one or more folders."
              />
            </RadioGroup>

            {scopeMode === "fileIds" && (
              <div className="grid h-[390px] grid-cols-[260px_1fr] overflow-hidden rounded-lg border">
                <ScrollArea className="h-full min-h-0 border-r bg-muted/30 py-2">
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground",
                      activeFolderId === "all" && "bg-accent font-semibold text-accent-foreground",
                    )}
                    onClick={() => setActiveFolderId("all")}
                  >
                    All files
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground",
                      activeFolderId === "root" && "bg-accent font-semibold text-accent-foreground",
                    )}
                    onClick={() => setActiveFolderId("root")}
                  >
                    File-area root
                  </button>
                  <FolderTree folders={folders} mode="nav" selectedId={activeFolderId} onSelect={setActiveFolderId} />
                </ScrollArea>
                <div className="flex min-h-0 min-w-0 flex-col">
                  <div className="flex h-[46px] shrink-0 items-center justify-between border-b px-3.5 text-xs text-muted-foreground">
                    <span>
                      <strong className="text-foreground">{selectedFileIds.size}</strong> selected
                    </span>
                    <button type="button" className="text-xs font-bold text-primary" onClick={toggleVisible}>
                      {allVisibleSelected ? "Clear visible" : "Select visible"}
                    </button>
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                    {visibleFiles.map((file) => (
                      <label
                        key={file.fileId}
                        className="flex items-center gap-2.5 border-b px-3.5 py-2.5 text-xs last:border-b-0 hover:bg-accent/50"
                      >
                        <Checkbox
                          checked={selectedFileIds.has(file.fileId)}
                          onCheckedChange={() => toggleFile(file.fileId)}
                        />
                        <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[9px] font-black text-primary uppercase">
                          {fileExt(file.fileName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-xs">{file.fileName}</strong>
                          <small className="block truncate text-[10px] text-muted-foreground">
                            {file.lastModified ? `Modified ${file.lastModified}` : file.fileId}
                          </small>
                        </span>
                      </label>
                    ))}
                    {!visibleFiles.length && <Empty>No files in this folder.</Empty>}
                  </ScrollArea>
                </div>
              </div>
            )}
            <div className="mt-4 max-w-sm">
              <div className="flex flex-col gap-1.5">
                <Label>First run</Label>
                <Select value={initialRun} onValueChange={setInitialRun}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baseline">Create baseline silently</SelectItem>
                    <SelectItem value="emitCurrent">Emit current files</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        ) : (
          <div>
            <p className="-mt-1 mb-4 text-xs text-muted-foreground">
              Choose the folders to check, apply filename rules, then preview the exact matching files.
            </p>
            <RadioGroup
              value={freshnessFolderMode}
              onValueChange={setFreshnessFolderMode}
              className="mb-5 flex flex-col gap-3 sm:flex-row sm:gap-6"
            >
              <PlainOption
                id="freshnessScope-all"
                value="all"
                title="All folders"
                description="Include files throughout the file area."
              />
              <PlainOption
                id="freshnessScope-folderIds"
                value="folderIds"
                title="Selected folders"
                description="Apply filters only inside the folders you choose."
              />
            </RadioGroup>

            {freshnessFolderMode === "folderIds" && (
              <div className="mb-5 overflow-hidden rounded-lg border bg-muted/30">
                <div className="p-3 pb-0">
                  <Input
                    type="search"
                    value={folderSearch}
                    onChange={(e) => setFolderSearch(e.target.value)}
                    placeholder="Search folders…"
                  />
                </div>
                <div className="flex h-[46px] items-center justify-between px-3.5 text-xs text-muted-foreground">
                  <span>
                    <strong className="text-foreground">{selectedFolderIds.size}</strong> folders selected
                  </span>
                  {selectedFolderIds.size > 0 && (
                    <button
                      type="button"
                      className="text-xs font-bold text-primary"
                      onClick={() => setSelectedFolderIds(new Set())}
                    >
                      Clear selection
                    </button>
                  )}
                </div>
                <ScrollArea className="h-[223px] px-1 pb-2">
                  <FolderTree
                    folders={folders}
                    mode="check"
                    selectedIds={selectedFolderIds}
                    onToggle={toggleFolder}
                    searchQuery={folderSearch}
                    emptyMessage="No folders found in this file area."
                  />
                </ScrollArea>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="extensions">Extensions</Label>
                <Input id="extensions" value={extensions} onChange={(e) => setExtensions(e.target.value)} placeholder="ifc, pdf" />
                <p className="text-xs text-muted-foreground">Comma-separated, with or without a dot.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="contains">Name contains</Label>
                <Input id="contains" value={contains} onChange={(e) => setContains(e.target.value)} placeholder="coordination, model" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Contains matching</Label>
                <Select value={containsMatch} onValueChange={setContainsMatch}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Match any value</SelectItem>
                    <SelectItem value="all">Match all values</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="notContains">Name does not contain</Label>
                <Input id="notContains" value={notContains} onChange={(e) => setNotContains(e.target.value)} placeholder="archive, old" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="startsWith">Name starts with</Label>
                <Input id="startsWith" value={startsWith} onChange={(e) => setStartsWith(e.target.value)} placeholder="C07_" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="endsWith">Name ends with</Label>
                <Input id="endsWith" value={endsWith} onChange={(e) => setEndsWith(e.target.value)} placeholder="_approved.ifc" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="maxAgeDays">Maximum age (whole days)</Label>
                <Input
                  id="maxAgeDays"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={maxAgeDays}
                  onChange={(e) => setMaxAgeDays(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border bg-primary/5 p-4">
              <div>
                <strong className="block text-sm">Preview matching files</strong>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Required before schedule and delivery settings are shown.
                </span>
              </div>
              <Button type="button" variant="outline" onClick={onPreviewFreshness}>
                Run preview
              </Button>
            </div>

            {previewIsCurrent && (
              <div className="mt-3.5 h-[300px] overflow-hidden rounded-lg border">
                <div className="flex h-[46px] items-center border-b px-3.5 text-xs text-muted-foreground">
                  <span>
                    <strong className="text-foreground">{freshnessPreviewFiles.length}</strong> matching files
                  </span>
                </div>
                <ScrollArea className="h-[calc(100%-46px)]">
                  {freshnessPreviewFiles.map((file) => (
                    <div key={file.fileId} className="flex items-center gap-2.5 border-b px-3.5 py-2.5 text-xs last:border-b-0">
                      <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[9px] font-black text-primary uppercase">
                        {fileExt(file.fileName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-xs">{file.fileName}</strong>
                        <small className="block truncate text-[10px] text-muted-foreground">
                          {file.lastModified ? `Modified ${file.lastModified}` : "No modified date"}
                        </small>
                      </span>
                    </div>
                  ))}
                  {!freshnessPreviewFiles.length && <Empty>No files match this folder scope and filter.</Empty>}
                </ScrollArea>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
