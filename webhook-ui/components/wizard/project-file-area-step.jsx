"use client";

import { CaretRightIcon, CircleNotchIcon } from "@phosphor-icons/react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Empty } from "@/components/wizard/folder-tree";
import { cn } from "@/lib/utils";

function EntityRow({ icon, title, subtitle, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md p-2.5 text-left hover:bg-accent",
        selected && "bg-accent",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-black text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm">{title}</strong>
        <small className="block truncate text-xs text-muted-foreground">{subtitle}</small>
      </span>
      <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function ProjectFileAreaStep({
  projects,
  project,
  fileAreas,
  fileArea,
  search,
  setSearch,
  busy,
  onChooseProject,
  onChooseFileArea,
}) {
  const filteredProjects = projects.filter((item) =>
    `${item.projectName} ${item.number || ""}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-extrabold tracking-wide text-primary">02</span>
          <CardTitle>Project and file area</CardTitle>
        </div>
        {project && fileArea && (
          <span className="truncate text-sm text-muted-foreground">
            {project.projectName} / {fileArea.fileAreaName}
          </span>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3.5 py-3">
            <h3 className="text-sm font-medium">Projects</h3>
            <span className="text-xs font-semibold text-muted-foreground">{projects.length}</span>
          </div>
          <div className="p-3 pb-0">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects…"
            />
          </div>
          <ScrollArea className="h-[280px] px-2 py-2">
            {filteredProjects.map((item) => (
              <EntityRow
                key={item.projectId}
                icon="P"
                title={item.projectName}
                subtitle={item.number || item.projectId}
                selected={project?.projectId === item.projectId}
                onClick={() => onChooseProject(item)}
              />
            ))}
            {!filteredProjects.length && <Empty>No projects found.</Empty>}
          </ScrollArea>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3.5 py-3">
            <h3 className="text-sm font-medium">File areas</h3>
            <span className="text-xs font-semibold text-muted-foreground">{fileAreas.length}</span>
          </div>
          <ScrollArea className="h-[343px] p-2">
            {busy === "fileAreas" && (
              <Empty>
                <CircleNotchIcon className="size-4 animate-spin" /> Loading file areas…
              </Empty>
            )}
            {busy !== "fileAreas" && !project && <Empty>Select a project to continue.</Empty>}
            {busy !== "fileAreas" &&
              project &&
              fileAreas.map((item) => (
                <EntityRow
                  key={item.fileAreaId}
                  icon="F"
                  title={item.fileAreaName}
                  subtitle={item.fileAreaType}
                  selected={fileArea?.fileAreaId === item.fileAreaId}
                  onClick={() => onChooseFileArea(item)}
                />
              ))}
            {busy !== "fileAreas" && project && !fileAreas.length && <Empty>No file areas found.</Empty>}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
