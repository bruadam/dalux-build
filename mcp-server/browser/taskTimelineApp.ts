/**
 * The MCP App that runs inside the `ui://dalux-build/task-timeline` iframe
 * (see ../src/ui/taskTimeline.ts). Bundled to a single inline `<script>` by
 * `scripts/build-task-timeline.mjs` — this file is browser code, not part
 * of the Node build (tsup only builds src/cli.ts and src/server.ts). It
 * lives outside src/ so the Node-side `tsc --noEmit` (which has no DOM lib)
 * never has to typecheck it.
 *
 * Renders a Gantt-style lifecycle timeline for the tasks in the tool's
 * `structuredContent` — no network fetch, unlike the IFC viewer: every
 * field the chart draws already arrived over the MCP Apps postMessage
 * channel, so this works identically over stdio and HTTP.
 */
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

interface TimelineTask {
  taskId: string;
  label: string;
  title?: string;
  status?: string;
  created?: string;
  deadline?: string;
}

interface ViewTasksTimelineResult {
  available: boolean;
  tasks?: TimelineTask[];
  skipped?: string[];
  message?: string;
}

function isTimelineResult(value: unknown): value is ViewTasksTimelineResult {
  return typeof value === 'object' && value !== null && typeof (value as { available?: unknown }).available === 'boolean';
}

const STYLE = `
.viz-root {
  color-scheme: light;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  --surface-1:      #fcfcfb;
  --text-primary:   #0b0b0b;
  --text-secondary: #52514e;
  --text-muted:     #898781;
  --gridline:       #e1e0d9;
  --border:         rgba(11,11,11,0.10);
  --status-good:      #0ca30c;
  --status-critical:  #d03b3b;
  --series-ontrack:   #2a78d6;
  padding: 12px;
  box-sizing: border-box;
  background: var(--surface-1);
  color: var(--text-primary);
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root {
    color-scheme: dark;
    --surface-1:      #1a1a19;
    --text-primary:   #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted:     #898781;
    --gridline:       #2c2c2a;
    --border:         rgba(255,255,255,0.10);
    --series-ontrack: #3987e5;
  }
}
:root[data-theme="dark"] .viz-root {
  color-scheme: dark;
  --surface-1:      #1a1a19;
  --text-primary:   #ffffff;
  --text-secondary: #c3c2b7;
  --text-muted:     #898781;
  --gridline:       #2c2c2a;
  --border:         rgba(255,255,255,0.10);
  --series-ontrack: #3987e5;
}
.viz-root * { box-sizing: border-box; }
.tl-header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.tl-title { font-weight: 600; color: var(--text-primary); }
.tl-legend { display: flex; gap: 14px; flex-wrap: wrap; }
.tl-legend-item { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); }
.tl-legend-swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.tl-chart { position: relative; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px 6px; }
.tl-axis { position: relative; height: 18px; margin-left: var(--tl-label-w, 140px); margin-bottom: 4px; }
.tl-tick { position: absolute; top: 0; transform: translateX(-50%); font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.tl-rows { position: relative; }
.tl-gridline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--gridline); }
.tl-today { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--text-muted); opacity: 0.6; }
.tl-today-label { position: absolute; font-size: 10px; color: var(--text-muted); transform: translateX(-50%); white-space: nowrap; }
.tl-row { position: relative; display: flex; align-items: center; height: 28px; border-radius: 4px; }
.tl-row:focus-visible { outline: 2px solid var(--series-ontrack); outline-offset: -2px; }
.tl-row:hover, .tl-row:focus-visible { background: var(--gridline); }
.tl-row-label { width: var(--tl-label-w, 140px); flex: none; padding-right: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
.tl-row-track { position: relative; flex: 1; height: 100%; }
.tl-bar { position: absolute; top: 50%; height: 14px; margin-top: -7px; border-radius: 7px; min-width: 4px; }
.tl-marker { position: absolute; top: 50%; width: 10px; height: 10px; margin-top: -5px; transform: translateX(-50%) rotate(45deg); }
.tl-marker.dot { border-radius: 50%; transform: translateX(-50%); }
.tl-tooltip { position: fixed; z-index: 10; max-width: 260px; background: var(--text-primary); color: var(--surface-1); padding: 8px 10px; border-radius: 6px; font-size: 12px; line-height: 1.45; pointer-events: none; opacity: 0; transition: opacity 0.08s ease; }
.tl-tooltip.visible { opacity: 1; }
.tl-tooltip strong { display: block; margin-bottom: 2px; }
.tl-empty { padding: 16px; text-align: center; color: var(--text-secondary); }
.tl-note { margin-top: 8px; font-size: 12px; color: var(--text-muted); }
.tl-table-wrap { margin-top: 14px; overflow-x: auto; }
.tl-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.tl-table caption { text-align: left; color: var(--text-muted); margin-bottom: 4px; }
.tl-table th, .tl-table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--gridline); color: var(--text-secondary); }
.tl-table th { color: var(--text-muted); font-weight: 500; }
.tl-table td:first-child, .tl-table th:first-child { color: var(--text-primary); }
`;

const COMPLETED_WORDS = ['closed', 'completed', 'done', 'approved', 'resolved', 'finished'];

type StatusBucket = 'completed' | 'overdue' | 'onTrack' | 'unscheduled';

function statusBucket(task: TimelineTask, now: number): StatusBucket {
  if (!task.created && !task.deadline) return 'unscheduled';
  const normalized = (task.status ?? '').toLowerCase();
  if (COMPLETED_WORDS.some((word) => normalized.includes(word))) return 'completed';
  if (task.deadline) {
    const deadlineMs = Date.parse(task.deadline);
    if (!Number.isNaN(deadlineMs) && deadlineMs < now) return 'overdue';
  }
  return 'onTrack';
}

function bucketColor(bucket: StatusBucket): string {
  switch (bucket) {
    case 'completed':
      return 'var(--status-good)';
    case 'overdue':
      return 'var(--status-critical)';
    default:
      return 'var(--series-ontrack)';
  }
}

function bucketLabel(bucket: StatusBucket): string {
  switch (bucket) {
    case 'completed':
      return 'Completed';
    case 'overdue':
      return 'Overdue';
    case 'onTrack':
      return 'On track';
    default:
      return 'Unscheduled';
  }
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function formatShort(ms: number): string {
  return dateFormatter.format(new Date(ms));
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return dateTimeFormatter.format(new Date(ms));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function renderTooltipContent(tooltip: HTMLElement, task: TimelineTask, bucket: StatusBucket): void {
  tooltip.textContent = '';
  const heading = el('strong');
  heading.textContent = task.label;
  tooltip.appendChild(heading);
  const lines: string[] = [];
  if (task.title) lines.push(task.title);
  lines.push(`Status: ${task.status ?? bucketLabel(bucket)}`);
  lines.push(`Created: ${formatDate(task.created)}`);
  lines.push(`Deadline: ${formatDate(task.deadline)}`);
  for (const line of lines) {
    const div = el('div');
    div.textContent = line;
    tooltip.appendChild(div);
  }
}

function renderEmpty(root: HTMLElement, text: string): void {
  root.textContent = '';
  const message = el('div', 'timeline-message');
  message.textContent = text;
  root.appendChild(message);
}

function renderTimeline(root: HTMLElement, app: App, result: ViewTasksTimelineResult): void {
  const tasks = result.tasks ?? [];
  if (!result.available || tasks.length === 0) {
    renderEmpty(root, result.message ?? 'No tasks to display.');
    return;
  }

  root.textContent = '';
  const style = el('style');
  style.textContent = STYLE;
  root.appendChild(style);

  const container = el('div', 'viz-root');
  root.appendChild(container);

  const now = Date.now();
  const bucketed = tasks.map((task) => ({ task, bucket: statusBucket(task, now) }));
  const scheduled = bucketed.filter((t) => t.bucket !== 'unscheduled');
  const unscheduledCount = bucketed.length - scheduled.length;

  const header = el('div', 'tl-header');
  const title = el('span', 'tl-title');
  title.textContent = `Task timeline (${tasks.length})`;
  header.appendChild(title);

  const legend = el('div', 'tl-legend');
  for (const bucket of ['onTrack', 'completed', 'overdue'] as const) {
    const item = el('span', 'tl-legend-item');
    const swatch = el('span', 'tl-legend-swatch');
    swatch.style.background = bucketColor(bucket);
    const label = el('span');
    label.textContent = bucketLabel(bucket);
    item.append(swatch, label);
    legend.appendChild(item);
  }
  header.appendChild(legend);
  container.appendChild(header);

  const tooltip = el('div', 'tl-tooltip');
  document.body.appendChild(tooltip);
  let tooltipVisible = false;
  const showTooltip = (targetEl: HTMLElement, task: TimelineTask, bucket: StatusBucket) => {
    renderTooltipContent(tooltip, task, bucket);
    const rect = targetEl.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, rect.left)}px`;
    tooltip.style.top = `${Math.max(8, rect.top - 8 - tooltip.offsetHeight)}px`;
    tooltip.classList.add('visible');
    tooltipVisible = true;
  };
  const hideTooltip = () => {
    if (tooltipVisible) {
      tooltip.classList.remove('visible');
      tooltipVisible = false;
    }
  };

  if (scheduled.length === 0) {
    const empty = el('div', 'tl-empty');
    empty.textContent = 'None of the selected tasks have a created date or deadline yet.';
    container.appendChild(empty);
  } else {
    const chart = el('div', 'tl-chart');

    const times = scheduled.flatMap(({ task }) =>
      [task.created, task.deadline].filter((v): v is string => !!v).map((v) => Date.parse(v)).filter((v) => !Number.isNaN(v)),
    );
    let domainMin = Math.min(...times);
    let domainMax = Math.max(...times);
    if (domainMin === domainMax) {
      const day = 24 * 60 * 60 * 1000;
      domainMin -= day;
      domainMax += day;
    }
    const pad = (domainMax - domainMin) * 0.05;
    domainMin -= pad;
    domainMax += pad;
    const span = domainMax - domainMin;
    const pct = (ms: number) => `${((ms - domainMin) / span) * 100}%`;

    const axis = el('div', 'tl-axis');
    const tickCount = 5;
    for (let i = 0; i < tickCount; i++) {
      const ms = domainMin + (span * i) / (tickCount - 1);
      const tick = el('span', 'tl-tick');
      tick.textContent = formatShort(ms);
      tick.style.left = pct(ms);
      axis.appendChild(tick);
    }
    chart.appendChild(axis);

    const rowsEl = el('div', 'tl-rows');
    rowsEl.style.setProperty('--tl-label-w', '140px');

    for (let i = 0; i < tickCount; i++) {
      const ms = domainMin + (span * i) / (tickCount - 1);
      const line = el('div', 'tl-gridline');
      line.style.left = `calc(140px + ${pct(ms)})`;
      rowsEl.appendChild(line);
    }

    if (now >= domainMin && now <= domainMax) {
      const todayLine = el('div', 'tl-today');
      todayLine.style.left = `calc(140px + ${pct(now)})`;
      rowsEl.appendChild(todayLine);
      const todayLabel = el('div', 'tl-today-label');
      todayLabel.textContent = 'Today';
      todayLabel.style.left = `calc(140px + ${pct(now)})`;
      todayLabel.style.top = '-16px';
      rowsEl.appendChild(todayLabel);
    }

    const sorted = [...scheduled].sort((a, b) => {
      const at = Date.parse(a.task.created ?? a.task.deadline ?? '');
      const bt = Date.parse(b.task.created ?? b.task.deadline ?? '');
      return at - bt;
    });

    for (const { task, bucket } of sorted) {
      const row = el('div', 'tl-row');
      row.tabIndex = 0;
      const label = el('span', 'tl-row-label');
      label.textContent = task.label;
      row.appendChild(label);

      const track = el('div', 'tl-row-track');
      const createdMs = task.created ? Date.parse(task.created) : NaN;
      const deadlineMs = task.deadline ? Date.parse(task.deadline) : NaN;
      const color = bucketColor(bucket);

      if (!Number.isNaN(createdMs) && !Number.isNaN(deadlineMs)) {
        const start = Math.min(createdMs, deadlineMs);
        const end = Math.max(createdMs, deadlineMs);
        const bar = el('div', 'tl-bar');
        bar.style.left = pct(start);
        bar.style.width = `calc(${pct(end)} - ${pct(start)})`;
        bar.style.background = color;
        track.appendChild(bar);
      } else if (!Number.isNaN(createdMs)) {
        const marker = el('div', 'tl-marker dot');
        marker.style.left = pct(createdMs);
        marker.style.background = color;
        track.appendChild(marker);
      } else if (!Number.isNaN(deadlineMs)) {
        const marker = el('div', 'tl-marker');
        marker.style.left = pct(deadlineMs);
        marker.style.background = color;
        track.appendChild(marker);
      }

      row.appendChild(track);
      const onEnter = () => showTooltip(row, task, bucket);
      row.addEventListener('pointerenter', onEnter);
      row.addEventListener('pointermove', onEnter);
      row.addEventListener('focus', onEnter);
      row.addEventListener('pointerleave', hideTooltip);
      row.addEventListener('blur', hideTooltip);
      row.addEventListener('click', () => {
        void app.updateModelContext({
          content: [
            {
              type: 'text',
              text: `Selected task ${task.label}${task.title ? ` (${task.title})` : ''}:\nStatus: ${task.status ?? bucketLabel(bucket)}\nCreated: ${formatDate(task.created)}\nDeadline: ${formatDate(task.deadline)}`,
            },
          ],
        });
      });
      rowsEl.appendChild(row);
    }

    chart.appendChild(rowsEl);
    container.appendChild(chart);
  }

  if (unscheduledCount > 0) {
    const note = el('div', 'tl-note');
    note.textContent = `${unscheduledCount} task(s) have no created date or deadline and aren't plotted — see the table below.`;
    container.appendChild(note);
  }

  const tableWrap = el('div', 'tl-table-wrap');
  const table = el('table', 'tl-table');
  const caption = el('caption');
  caption.textContent = 'All selected tasks';
  table.appendChild(caption);
  const thead = el('thead');
  const headRow = el('tr');
  for (const heading of ['Task', 'Title', 'Status', 'Created', 'Deadline']) {
    const th = el('th');
    th.textContent = heading;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const { task, bucket } of bucketed) {
    const tr = el('tr');
    const cells = [task.label, task.title ?? '—', task.status ?? bucketLabel(bucket), formatDate(task.created), formatDate(task.deadline)];
    for (const value of cells) {
      const td = el('td');
      td.textContent = value;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);

  if (result.skipped && result.skipped.length > 0) {
    const note = el('div', 'tl-note');
    note.textContent = `Couldn't load: ${result.skipped.join(', ')}`;
    container.appendChild(note);
  }
}

async function main(): Promise<void> {
  const app = new App({ name: 'dalux-task-timeline', version: '1.0.0' }, {}, { autoResize: true });
  const root = document.getElementById('root');

  app.addEventListener('toolresult', (result) => {
    if (!root) return;
    renderTimeline(root, app, isTimelineResult(result.structuredContent) ? result.structuredContent : { available: false });
  });
  app.addEventListener('hostcontextchanged', (ctx) => {
    document.documentElement.dataset.theme = ctx.theme ?? 'light';
  });

  if (root) renderEmpty(root, 'Loading tasks…');
  await app.connect(new PostMessageTransport(window.parent, window.parent));
}

main().catch((err) => {
  const root = document.getElementById('root');
  if (root) renderEmpty(root, `Failed to initialize timeline: ${err instanceof Error ? err.message : String(err)}`);
});
