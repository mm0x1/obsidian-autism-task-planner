import { Plugin, WorkspaceLeaf } from 'obsidian';
import { TaskPlannerView, VIEW_TYPE_TASK_PLANNER } from './taskView';
import { TaskPlannerSettingsTab, TaskPlannerSettings, DEFAULT_SETTINGS } from './settingsTab';

export default class TaskPlannerPlugin extends Plugin {
	settings: TaskPlannerSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register the sidebar view
		this.registerView(
			VIEW_TYPE_TASK_PLANNER,
			(leaf: WorkspaceLeaf) => {
				const view = new TaskPlannerView(leaf);
				view.plugin = this;
				return view;
			},
		);

		// Command: open task planner
		this.addCommand({
			id: 'open-task-planner',
			name: 'Open task planner',
			callback: () => this.activateView(),
		});

		// Ribbon icon for quick access
		this.addRibbonIcon('check-square', 'Task planner', () => this.activateView());

		// Settings tab
		this.addSettingTab(new TaskPlannerSettingsTab(this.app, this));
	}

	onunload(): void {
		// intentionally empty — leaves are managed by Obsidian
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		// If already open, reveal it
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TASK_PLANNER);
		if (existing.length > 0) {
			void workspace.revealLeaf(existing[0]!);
			return;
		}

		// Open in right sidebar
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({
			type: VIEW_TYPE_TASK_PLANNER,
			active: true,
		});
		void workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData() as Partial<TaskPlannerSettings>,
		);
		// Ensure categoryColors is always an object (in case loadData returns partial)
		if (!this.settings.categoryColors) {
			this.settings.categoryColors = { ...DEFAULT_SETTINGS.categoryColors };
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
