import { useState } from "react";
import { FileText, Plus, Trash2, Edit3 } from "lucide-react";
import { PRIORITY_META, PRIORITY } from "../../../lib/notifications/types";
import StaffDropdown from "../components/StaffDropdown.jsx";

export default function TemplateManager({ templates, onCreate, onUpdate, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [formState, setFormState] = useState({ name: "", title: "", message: "", priority: PRIORITY.INFO });

  const handleEdit = (template) => {
    setEditingId(template.id);
    setFormState({
      name: template.name,
      title: template.title,
      message: template.message,
      priority: template.priority,
    });
  };

  const handleSave = () => {
    if (!formState.name || !formState.title || !formState.message) return;
    if (editingId) {
      onUpdate(editingId, formState);
    } else {
      onCreate(formState);
    }
    setEditingId(null);
    setFormState({ name: "", title: "", message: "", priority: PRIORITY.INFO });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-sky-400 uppercase tracking-[0.2em] font-semibold">
            Templates
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Manage notification templates</h2>
          <p className="mt-2 text-sm text-gray-400 max-w-2xl">
            Create, edit, and delete notification templates for quick use in the Compose tab.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_0.7fr]">
        <div className="rounded-3xl border border-gray-700/60 bg-gray-900/70 p-5">
          <div className="flex items-center gap-3 text-sky-400 mb-5">
            <FileText size={18} />
            <h3 className="text-lg font-semibold text-white">Template list</h3>
          </div>
          <div className="space-y-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className="rounded-3xl border border-gray-700/80 bg-gray-950/60 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="font-semibold text-white">{template.name}</p>
                    <p className="mt-1 text-sm text-gray-400">{template.title}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-gray-400">
                    <span className={`rounded-full px-3 py-1 ${PRIORITY_META[template.priority].badge}`}>
                      {PRIORITY_META[template.priority].label}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleEdit(template)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-gray-700/80 bg-gray-900 px-3 py-2 text-xs text-sky-200 hover:bg-sky-500/10"
                    >
                      <Edit3 size={14} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(template.id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200 hover:bg-red-500/15"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-gray-700/60 bg-gray-900/70 p-5">
          <div className="flex items-center gap-3 text-sky-400 mb-5">
            <Plus size={18} />
            <h3 className="text-lg font-semibold text-white">
              {editingId ? "Edit template" : "Create new template"}
            </h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-300">Template name</label>
              <input
                value={formState.name}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, name: event.target.value }))
                }
                className="w-full rounded-2xl border border-gray-700/80 bg-gray-900 px-4 py-3 text-sm text-gray-100 outline-none focus:border-sky-400"
                placeholder="Example: Maintenance notice"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-300">Title</label>
              <input
                value={formState.title}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, title: event.target.value }))
                }
                className="w-full rounded-2xl border border-gray-700/80 bg-gray-900 px-4 py-3 text-sm text-gray-100 outline-none focus:border-sky-400"
                placeholder="Title notifications"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-300">Content</label>
              <textarea
                rows={5}
                value={formState.message}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, message: event.target.value }))
                }
                className="w-full rounded-3xl border border-gray-700/80 bg-gray-900 px-4 py-4 text-sm text-gray-100 outline-none focus:border-sky-400 resize-none"
                placeholder="Notification template content"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-300">Priority</label>
              <StaffDropdown
                value={formState.priority}
                onChange={(value) =>
                  setFormState((prev) => ({ ...prev, priority: value }))
                }
                options={Object.entries(PRIORITY_META).map(([key, meta]) => [key, meta.label])}
                ariaLabel="Select template priority"
                icon={FileText}
                className="w-full"
                buttonClassName="h-12 rounded-2xl bg-gray-900 px-4"
                menuClassName="w-full"
              />
            </div>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center justify-center gap-2 rounded-3xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-400"
            >
              <Plus size={16} />
              {editingId ? "Update template" : "Create new template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
