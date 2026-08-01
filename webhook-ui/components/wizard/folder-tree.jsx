"use client";

import { useEffect, useMemo, useState } from "react";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export function Empty({ children }) {
  return (
    <div className="flex min-h-[100px] items-center justify-center gap-2 p-5 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function useFolderHierarchy(folders) {
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

export function FolderTree({
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
        <div className="flex items-center" style={{ paddingLeft: `${depth * 16}px` }}>
          <button
            type="button"
            className="flex h-7 w-6 flex-none items-center justify-center text-muted-foreground disabled:cursor-default enabled:cursor-pointer enabled:hover:text-foreground"
            disabled={!hasChildren}
            aria-label={expanded ? "Collapse folder" : "Expand folder"}
            onClick={() => toggleCollapse(folder.folderId)}
          >
            {hasChildren ? (
              expanded ? (
                <CaretDownIcon className="size-3" />
              ) : (
                <CaretRightIcon className="size-3" />
              )
            ) : null}
          </button>
          {mode === "nav" ? (
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground",
                selectedId === folder.folderId && "bg-accent font-semibold text-accent-foreground",
              )}
              onClick={() => onSelect(folder.folderId)}
            >
              <span>{folder.folderName}</span>
            </button>
          ) : (
            <label className="flex w-full flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground">
              <Checkbox
                checked={selectedIds.has(folder.folderId)}
                onCheckedChange={() => onToggle(folder.folderId)}
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
