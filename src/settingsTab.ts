import { PluginSettingTab, Setting } from "obsidian";
import type TaskPlannerPlugin from "./main";

export interface TaskPlannerSettings {
  defaultStartTime: string; // "HH:MM" or "" to use current time
  syncReorder: boolean;
  syncCompletions: boolean;
  syncDurations: boolean;
  categoryColors: Record<string, string>;
}

export const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  hygiene:   "#4A90D9",  // blue
  grooming:  "#7B68EE",  // slate blue
  health:    "#5CB85C",  // green
  cleaning:  "#F0AD4E",  // amber
  chores:    "#D9534F",  // red
  hobby:     "#9B59B6",  // purple
  work:      "#1ABC9C",  // teal
  cooking:   "#E67E22",  // warm orange
  exercise:  "#27AE60",  // forest green
  social:    "#E91E63",  // pink
  errands:   "#795548",  // brown
  finance:   "#00BCD4",  // cyan
  learning:  "#3F51B5",  // indigo
  creative:  "#FF5722",  // deep orange
  selfcare:  "#EC407A",  // rose
  family:    "#FF9800",  // amber-gold
  other:     "#95A5A6",  // gray
};

export const DEFAULT_SETTINGS: TaskPlannerSettings = {
  defaultStartTime: "",
  syncReorder: false,
  syncCompletions: false,
  syncDurations: false,
  categoryColors: { ...DEFAULT_CATEGORY_COLORS },
};

export class TaskPlannerSettingsTab extends PluginSettingTab {
  plugin: TaskPlannerPlugin;

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Task planner").setHeading();

    // --- Default start time ---
    new Setting(containerEl)
      .setName("Default start time")
      .setDesc(
        "Leave blank to use the current time. Enter a time in 24-hour format, e.g. 09:00.",
      )
      .addText((text) =>
        text
          .setPlaceholder("09:00")
          .setValue(this.plugin.settings.defaultStartTime)
          .onChange(async (value) => {
            this.plugin.settings.defaultStartTime = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    // --- Sync toggles ---
    new Setting(containerEl).setName("Markdown sync").setHeading();

    new Setting(containerEl)
      .setName("Sync reorder back to file")
      .setDesc(
        "When enabled, dragging cards to reorder them rewrites the Markdown file in the new order.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncReorder)
          .onChange(async (value) => {
            this.plugin.settings.syncReorder = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Sync completions to file")
      .setDesc(
        "When enabled, completing a task rewrites that line as - [X] ... In the Markdown file.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncCompletions)
          .onChange(async (value) => {
            this.plugin.settings.syncCompletions = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Sync edited durations to file")
      .setDesc(
        "When enabled, editing a duration in the panel writes the change back to the Markdown file.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncDurations)
          .onChange(async (value) => {
            this.plugin.settings.syncDurations = value;
            await this.plugin.saveSettings();
          }),
      );

    // --- Category colors ---
    new Setting(containerEl).setName("Category colors").setHeading();

    const colors = this.plugin.settings.categoryColors;
    const allCategories = Array.from(
      new Set([
        ...Object.keys(DEFAULT_CATEGORY_COLORS),
        ...Object.keys(colors),
      ]),
    ).sort();

    for (const cat of allCategories) {
      const currentColor =
        colors[cat] ?? DEFAULT_CATEGORY_COLORS[cat] ?? "#95A5A6";
      new Setting(containerEl).setName(cat).addColorPicker((picker) =>
        picker.setValue(currentColor).onChange(async (value) => {
          this.plugin.settings.categoryColors[cat] = value;
          await this.plugin.saveSettings();
        }),
      );
    }
  }
}
