import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import Sortable from 'sortablejs';
import type TaskPlannerPlugin from './main';
import {
	Task,
	addMinutes,
	formatDuration,
	formatTime,
	parseDurationToken,
	parseNote,
} from './taskParser';
import { DEFAULT_CATEGORY_COLORS } from './settingsTab';

export const VIEW_TYPE_TASK_PLANNER = 'task-planner-view';

function capitalizeFirst(str: string): string {
	return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

function hexToRgba(hex: string, alpha: number): string {
	const h = hex.replace('#', '');
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class TaskPlannerView extends ItemView {
	plugin: TaskPlannerPlugin;

	private tasks: Task[] = [];
	private startTime: Date = new Date();
	private sourceFile: TFile | null = null;
	private sortable: Sortable | null = null;

	// DOM refs
	private startTimeInput: HTMLInputElement | null = null;
	private listEl: HTMLElement | null = null;
	private footerEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TaskPlannerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TASK_PLANNER;
	}

	getDisplayText(): string {
		return 'Task Planner';
	}

	getIcon(): string {
		return 'check-square';
	}

	async onOpen(): Promise<void> {
		this.loadStartTime();
		await this.loadTasksFromActiveNote();
		this.render();
	}

	async onClose(): Promise<void> {
		this.sortable?.destroy();
		this.sortable = null;
	}

	// -------------------------------------------------------------------------
	// Loading

	private loadStartTime(): void {
		const setting = this.plugin.settings.defaultStartTime;
		if (setting && /^\d{1,2}:\d{2}$/.test(setting)) {
			const [hStr, mStr] = setting.split(':');
			const h = parseInt(hStr!);
			const m = parseInt(mStr!);
			const d = new Date();
			d.setHours(h, m, 0, 0);
			this.startTime = d;
		} else {
			// Round to current minute
			const now = new Date();
			now.setSeconds(0, 0);
			this.startTime = now;
		}
	}

	async loadTasksFromActiveNote(): Promise<void> {
		// Try the currently focused leaf first, then fall back to any open markdown leaf.
		// This handles the common case where the sidebar panel itself has focus.
		let file: TFile | null = null;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file) {
			file = activeView.file;
		} else {
			// Walk all open markdown leaves and pick the first one with a file.
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			for (const leaf of leaves) {
				const view = leaf.view as MarkdownView;
				if (view?.file) {
					file = view.file;
					break;
				}
			}
		}

		if (!file) {
			// Only clear if we have nothing yet; preserve existing tasks on a failed refresh.
			if (!this.sourceFile) this.tasks = [];
			return;
		}

		this.sourceFile = file;
		const content = await this.app.vault.read(this.sourceFile);
		this.tasks = parseNote(content);
	}

	async refresh(): Promise<void> {
		// Always re-detect the active note so switching notes is picked up,
		// and reset the clock so start times reflect the current time.
		this.loadStartTime();
		await this.loadTasksFromActiveNote();
		this.render();
	}

	// -------------------------------------------------------------------------
	// Rendering

	render(): void {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass('task-planner-root');

		this.renderHeader(root);
		this.renderList(root);
		this.renderFooter(root);
	}

	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: 'tp-header' });

		// Title + refresh
		const titleRow = header.createDiv({ cls: 'tp-title-row' });
		titleRow.createEl('h4', { text: 'Task Planner', cls: 'tp-title' });

		const refreshBtn = titleRow.createEl('button', { cls: 'tp-btn-icon', title: 'Reload from active note' });
		refreshBtn.innerHTML = '↺';
		refreshBtn.addEventListener('click', () => this.refresh());

		// Source file name
		if (this.sourceFile) {
			header.createDiv({
				cls: 'tp-source-name',
				text: `From: ${this.sourceFile.basename}`,
			});
		} else {
			header.createDiv({
				cls: 'tp-source-name tp-warn',
				text: 'No active markdown note. Open a note and click ↺.',
			});
		}

		// Start time row
		const startRow = header.createDiv({ cls: 'tp-start-row' });
		startRow.createSpan({ text: 'Start:', cls: 'tp-label' });

		const input = startRow.createEl('input', { cls: 'tp-start-input', type: 'time' }) as HTMLInputElement;
		const h = this.startTime.getHours().toString().padStart(2, '0');
		const m = this.startTime.getMinutes().toString().padStart(2, '0');
		input.value = `${h}:${m}`;
		this.startTimeInput = input;

		input.addEventListener('change', () => {
			const val = input.value;
			if (!val) return;
			const [hh, mm] = val.split(':');
			const d = new Date(this.startTime);
			d.setHours(parseInt(hh!), parseInt(mm!), 0, 0);
			this.startTime = d;
			this.recalcTimes();
		});
	}

	private renderList(root: HTMLElement): void {
		const listEl = root.createDiv({ cls: 'tp-list' });
		this.listEl = listEl;
		this.rebuildCards();
	}

	private rebuildCards(): void {
		if (!this.listEl) return;
		this.listEl.empty();
		this.sortable?.destroy();
		this.sortable = null;

		if (this.tasks.length === 0) {
			this.listEl.createDiv({ cls: 'tp-empty', text: 'No tasks found.' });
			return;
		}

		for (const task of this.tasks) {
			this.createCard(task, this.listEl);
		}

		// Set up Sortable on the active (non-completed) items
		this.sortable = Sortable.create(this.listEl, {
			animation: 150,
			ghostClass: 'tp-card-ghost',
			filter: '.tp-card--done',
			// Must be false — the default (true) calls preventDefault() on every click
			// that touches a filtered card, which swallows button click events on done cards.
			preventOnFilter: false,
			// Restrict drag to the handle only — without this, any touch on the card
			// starts a drag, making it impossible to scroll on mobile.
			handle: '.tp-drag-handle',
			onEnd: (evt) => {
				const { oldIndex, newIndex } = evt;
				if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
				// Reorder tasks array (only active tasks participate)
				const activeTasks = this.tasks.filter(t => !t.completed);
				const doneTasks = this.tasks.filter(t => t.completed);
				const moved = activeTasks.splice(oldIndex, 1)[0];
				if (moved) activeTasks.splice(newIndex, 0, moved);
				this.tasks = [...activeTasks, ...doneTasks];
				this.recalcTimes();
				if (this.plugin.settings.syncReorder) {
					this.syncReorderToFile().catch(console.error);
				}
			},
		});
	}

	private createCard(task: Task, container: HTMLElement): HTMLElement {
		const card = container.createDiv({
			cls: `tp-card${task.completed ? ' tp-card--done' : ''}`,
			attr: { 'data-task-id': task.id },
		});

		// Drag handle
		const handle = card.createDiv({ cls: 'tp-drag-handle', title: 'Drag to reorder' });
		handle.innerHTML = '⠿';

		// Main content
		const body = card.createDiv({ cls: 'tp-card-body' });

		// Name
		const nameEl = body.createDiv({ cls: 'tp-task-name' });
		nameEl.textContent = capitalizeFirst(task.name);

		// Meta row: category badge + duration badge + start time
		const meta = body.createDiv({ cls: 'tp-card-meta' });

		const catBadge = meta.createSpan({ cls: 'tp-badge tp-badge-cat', title: 'Click to change category' });
		catBadge.textContent = task.category;
		this.applyBadgeStyle(catBadge, this.categoryColor(task.category));
		catBadge.addEventListener('click', () => this.startCategoryEdit(task, catBadge));

		const durBadge = meta.createSpan({ cls: 'tp-badge tp-badge-dur', title: 'Click to edit duration' });
		durBadge.textContent = formatDuration(task.durationMinutes);
		durBadge.addEventListener('click', () => this.startDurationEdit(task, durBadge));

		if (task.recurring) {
			const recurBadge = meta.createSpan({ cls: 'tp-badge tp-badge-recur', title: 'Recurring task' });
			recurBadge.textContent = '↻';
		}

		const startLabel = meta.createSpan({ cls: 'tp-start-label' });
		startLabel.textContent = this.calcStartTime(task);
		startLabel.setAttribute('data-start-label', task.id);

		// Action buttons
		const actions = card.createDiv({ cls: 'tp-card-actions' });

		if (!task.completed) {
			const completeBtn = actions.createEl('button', {
				cls: 'tp-btn-icon tp-btn-complete',
				title: 'Mark complete',
			});
			completeBtn.innerHTML = '✓';
			completeBtn.addEventListener('click', () => this.completeTask(task));
		} else {
			const uncompleteBtn = actions.createEl('button', {
				cls: 'tp-btn-icon tp-btn-uncomplete',
				title: 'Mark incomplete',
			});
			uncompleteBtn.innerHTML = '↩';
			uncompleteBtn.addEventListener('click', () => this.uncompleteTask(task));
		}

		const deleteBtn = actions.createEl('button', {
			cls: 'tp-btn-icon tp-btn-delete',
			title: 'Remove from planner',
		});
		deleteBtn.innerHTML = '✕';
		deleteBtn.addEventListener('click', () => this.deleteTask(task));

		return card;
	}

	// -------------------------------------------------------------------------
	// Time calculation

	private calcStartTime(task: Task): string {
		const activeTasks = this.tasks.filter(t => !t.completed);
		const idx = activeTasks.indexOf(task);
		if (idx < 0) return '';
		let time = new Date(this.startTime);
		for (let i = 0; i < idx; i++) {
			time = addMinutes(time, activeTasks[i]!.durationMinutes);
		}
		return formatTime(time);
	}

	recalcTimes(): void {
		if (!this.listEl) return;
		const activeTasks = this.tasks.filter(t => !t.completed);
		let time = new Date(this.startTime);

		for (let i = 0; i < activeTasks.length; i++) {
			const task = activeTasks[i]!;
			const label = this.listEl.querySelector(`[data-start-label="${task.id}"]`) as HTMLElement | null;
			if (label) label.textContent = formatTime(time);
			time = addMinutes(time, task.durationMinutes);
		}

		// Update duration badges in case they changed
		for (const task of activeTasks) {
			const card = this.listEl.querySelector(`[data-task-id="${task.id}"]`);
			if (card) {
				const badge = card.querySelector('.tp-badge-dur') as HTMLElement | null;
				if (badge && !badge.contains(document.activeElement)) {
					badge.textContent = formatDuration(task.durationMinutes);
				}
			}
		}

		this.renderFooter(this.containerEl.children[1] as HTMLElement);
	}

	private renderFooter(root: HTMLElement): void {
		// Remove existing footer
		const existing = root.querySelector('.tp-footer');
		if (existing) existing.remove();

		const footer = root.createDiv({ cls: 'tp-footer' });
		this.footerEl = footer;

		const activeTasks = this.tasks.filter(t => !t.completed);
		const totalMins = activeTasks.reduce((sum, t) => sum + t.durationMinutes, 0);
		const endTime = addMinutes(this.startTime, totalMins);

		footer.createDiv({
			cls: 'tp-footer-times',
			text: `${activeTasks.length} tasks · ${formatDuration(totalMins)} · Done at ${formatTime(endTime)}`,
		});

		const footerBtns = footer.createDiv({ cls: 'tp-footer-btns' });

		const clearBtn = footerBtns.createEl('button', {
			cls: 'tp-btn tp-btn-clear',
			text: 'Clear completed',
		});
		clearBtn.addEventListener('click', () => this.clearCompleted());

		const hasRecurringCompleted = this.tasks.some(t => t.recurring && t.completed);
		if (hasRecurringCompleted) {
			const resetBtn = footerBtns.createEl('button', {
				cls: 'tp-btn tp-btn-reset',
				text: 'Reset all',
				attr: { title: 'Reset all recurring tasks to incomplete' },
			});
			resetBtn.addEventListener('click', () => this.resetRecurring().catch(console.error));
		}
	}

	// -------------------------------------------------------------------------
	// Duration inline editing

	private startDurationEdit(task: Task, badge: HTMLElement): void {
		if (badge.querySelector('input')) return; // already editing

		const prev = badge.textContent ?? '';
		badge.empty();

		const input = badge.createEl('input', { cls: 'tp-dur-input', type: 'text' }) as HTMLInputElement;
		input.value = prev;
		input.style.width = `${Math.max(prev.length + 1, 4)}ch`;
		input.select();

		const commit = async () => {
			const raw = input.value.trim().toLowerCase();
			let mins = parseDurationToken(raw);
			// Also allow plain numbers as minutes
			if (!raw.match(/[hm]/) && /^\d+$/.test(raw)) {
				mins = parseInt(raw);
			}
			if (mins < 0 || isNaN(mins)) mins = task.durationMinutes;
			task.durationMinutes = mins;
			badge.textContent = formatDuration(mins);
			this.recalcTimes();
			if (this.plugin.settings.syncDurations && this.sourceFile) {
				await this.syncDurationToFile(task);
			}
		};

		input.addEventListener('blur', commit);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
			if (e.key === 'Escape') { badge.textContent = prev; }
		});

		input.focus();
	}

	private startCategoryEdit(task: Task, badge: HTMLElement): void {
		if (badge.querySelector('select')) return; // already editing

		// Build sorted list of all known categories
		const allCategories = Array.from(new Set([
			...Object.keys(DEFAULT_CATEGORY_COLORS),
			...Object.keys(this.plugin.settings.categoryColors),
			task.category,
		])).sort();

		const prevCategory = task.category;
		const prevColor = this.categoryColor(prevCategory);
		badge.empty();

		const select = badge.createEl('select', { cls: 'tp-cat-select' }) as HTMLSelectElement;
		// Match the select text color to the badge text color
		select.style.color = prevColor;
		for (const cat of allCategories) {
			const opt = select.createEl('option', { text: cat, value: cat });
			if (cat === task.category) opt.selected = true;
		}

		const commit = async (newCat: string) => {
			task.category = newCat;
			badge.empty();
			badge.textContent = newCat;
			this.applyBadgeStyle(badge, this.categoryColor(newCat));
			if (this.sourceFile) {
				await this.syncCategoryToFile(task, prevCategory);
			}
		};

		// change fires before blur — commit, then blur becomes a no-op
		select.addEventListener('change', () => {
			commit(select.value).catch(console.error);
		});

		// blur without a prior change = user cancelled, restore original
		select.addEventListener('blur', () => {
			if (badge.querySelector('select')) {
				badge.empty();
				badge.textContent = prevCategory;
				this.applyBadgeStyle(badge, prevColor);
			}
		});

		select.focus();
	}

	// -------------------------------------------------------------------------
	// Task actions

	private completeTask(task: Task): void {
		task.completed = true;
		if (this.plugin.settings.syncCompletions && this.sourceFile) {
			this.syncCompleteToFile(task).catch(console.error);
		}
		this.rebuildCards();
		this.recalcTimes();
	}

	private uncompleteTask(task: Task): void {
		task.completed = false;
		if (this.plugin.settings.syncCompletions && this.sourceFile) {
			this.syncUncompleteToFile(task).catch(console.error);
		}
		this.rebuildCards();
		this.recalcTimes();
	}

	private deleteTask(task: Task): void {
		this.tasks = this.tasks.filter(t => t.id !== task.id);
		if (this.sourceFile) {
			this.syncDeleteToFile(task).catch(console.error);
		}
		const card = this.listEl?.querySelector(`[data-task-id="${task.id}"]`);
		card?.remove();
		this.recalcTimes();
	}

	private clearCompleted(): void {
		// Recurring tasks are never cleared — they reset via "Reset all"
		const toRemove = this.tasks.filter(t => t.completed && !t.recurring);
		this.tasks = this.tasks.filter(t => !t.completed || t.recurring);
		if (this.sourceFile && toRemove.length > 0) {
			this.syncBulkDeleteToFile(toRemove).catch(console.error);
		}
		this.rebuildCards();
		this.recalcTimes();
	}

	private async resetRecurring(): Promise<void> {
		const toReset = this.tasks.filter(t => t.recurring && t.completed);
		for (const task of toReset) task.completed = false;
		if (this.plugin.settings.syncCompletions && this.sourceFile && toReset.length > 0) {
			const indices = new Set(toReset.map(t => t.lineIndex));
			await this.modifyLines('could not reset recurring tasks in file', (lines) => {
				for (const i of indices) {
					const line = lines[i];
					if (line !== undefined && line.startsWith('- [')) {
						lines[i] = '- ' + line.replace(/^- \[.\] ?/, '');
					}
				}
			});
		}
		this.rebuildCards();
		this.recalcTimes();
	}

	// -------------------------------------------------------------------------
	// Markdown sync

	/** Read the file, let fn mutate the lines array in place, then write back. */
	private async modifyLines(errorMsg: string, fn: (lines: string[]) => void): Promise<void> {
		if (!this.sourceFile) return;
		try {
			const content = await this.app.vault.read(this.sourceFile);
			const lines = content.split('\n');
			fn(lines);
			await this.app.vault.modify(this.sourceFile, lines.join('\n'));
		} catch (e) {
			new Notice(`Task Planner: ${errorMsg}.`);
			console.error(e);
		}
	}

	private async syncCompleteToFile(task: Task): Promise<void> {
		await this.modifyLines('could not sync completion to file', (lines) => {
			const line = lines[task.lineIndex];
			if (line === undefined || !/^- /i.test(line) || /^- \[x\]/i.test(line)) return;
			// Plain item → prepend [x]; unchecked [ ] → flip bracket
			lines[task.lineIndex] = line.startsWith('- [')
				? line.replace(/^- \[.\]/, '- [x]')
				: `- [x] ${line.slice(2)}`;
		});
	}

	private async syncUncompleteToFile(task: Task): Promise<void> {
		await this.modifyLines('could not sync uncomplete to file', (lines) => {
			const line = lines[task.lineIndex];
			if (line !== undefined && line.startsWith('- [')) {
				lines[task.lineIndex] = '- ' + line.replace(/^- \[.\] ?/, '');
			}
		});
	}

	private async syncDeleteToFile(task: Task): Promise<void> {
		await this.modifyLines('could not sync deletion to file', (lines) => {
			lines.splice(task.lineIndex, 1);
		});
	}

	private async syncBulkDeleteToFile(tasks: Task[]): Promise<void> {
		if (tasks.length === 0) return;
		const indicesToRemove = new Set(tasks.map(t => t.lineIndex));
		await this.modifyLines('could not clear completed tasks from file', (lines) => {
			const kept = lines.filter((_, i) => !indicesToRemove.has(i));
			lines.splice(0, lines.length, ...kept);
		});
	}

	private async syncReorderToFile(): Promise<void> {
		await this.modifyLines('could not sync reorder to file', (lines) => {
			const sortedIndices = this.tasks.map(t => t.lineIndex).sort((a, b) => a - b);
			// Use current file content at each task's position — not stale task.raw
			const reorderedLines = this.tasks.map(t => (lines[t.lineIndex] ?? t.raw).trimEnd());
			for (let i = 0; i < sortedIndices.length; i++) {
				const idx = sortedIndices[i];
				if (idx !== undefined && reorderedLines[i] !== undefined) {
					lines[idx] = reorderedLines[i]!;
				}
			}
		});
	}

	private async syncCategoryToFile(task: Task, prevCategory: string): Promise<void> {
		await this.modifyLines('could not sync category to file', (lines) => {
			const line = lines[task.lineIndex];
			if (line === undefined) return;
			lines[task.lineIndex] = line.replace(
				new RegExp(`(\\s)-${prevCategory}(\\s*)$`),
				`$1-${task.category}$2`,
			);
		});
	}

	private async syncDurationToFile(task: Task): Promise<void> {
		await this.modifyLines('could not sync duration to file', (lines) => {
			const line = lines[task.lineIndex];
			if (line === undefined) return;
			lines[task.lineIndex] = line.replace(/(\d+h\d+m|\d+h|\d+m)/, formatDuration(task.durationMinutes));
		});
	}

	// -------------------------------------------------------------------------
	// Helpers

	private categoryColor(cat: string): string {
		const userColors = this.plugin.settings.categoryColors;
		return userColors[cat] ?? DEFAULT_CATEGORY_COLORS[cat] ?? DEFAULT_CATEGORY_COLORS['other']!;
	}

	// Apply the dark-mode badge style: colored text + border, low-opacity fill
	private applyBadgeStyle(el: HTMLElement, color: string): void {
		el.style.color = color;
		el.style.borderColor = color;
		el.style.backgroundColor = hexToRgba(color, 0.18);
	}
}
