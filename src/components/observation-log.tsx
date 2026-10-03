"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { Observation } from "@/lib/types";

/**
 * The observing log: full CRUD over observations through the UI.
 *
 * Create, edit and delete all hit the REST routes, and each is reflected by the
 * server on the next render, so the list is never optimistically wrong.
 */
export function ObservationLog({
  initial,
  suggestions,
}: {
  initial: Observation[];
  suggestions: Array<{ objectId: string; name: string; planId: string }>;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Observation[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const [form, setForm] = useState({
    objectId: suggestions[0]?.objectId ?? "",
    objectName: suggestions[0]?.name ?? "",
    planId: suggestions[0]?.planId ?? "",
    seenOn: new Date().toISOString().slice(0, 10),
    confidence: 3,
    notes: "",
  });

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/observations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, planId: form.planId || null }),
      });
      const body = (await response.json()) as Observation & { error?: { message: string } };
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? `Request failed with status ${response.status}`);
      }
      setItems((prev) => [body, ...prev]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the observation.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, changes: Partial<Observation>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/observations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      const body = (await response.json()) as Observation & { error?: { message: string } };
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? `Request failed with status ${response.status}`);
      }
      setItems((prev) => prev.map((o) => (o.id === id ? body : o)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the observation.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/observations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message: string } };
        throw new Error(body.error?.message ?? `Request failed with status ${response.status}`);
      }
      setItems((prev) => prev.filter((o) => o.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the observation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <form
        className="plate p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h2 className="plate-caption">Add an entry</h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mono-label">Target</span>
            <select
              className="field mt-1"
              value={`${form.planId}|${form.objectId}`}
              onChange={(e) => {
                const [planId, objectId] = e.target.value.split("|");
                const match = suggestions.find((s) => s.objectId === objectId);
                setForm((f) => ({
                  ...f,
                  planId: planId ?? "",
                  objectId: objectId ?? "",
                  objectName: match?.name ?? objectId ?? "",
                }));
              }}
              data-testid="log-target"
            >
              {suggestions.length === 0 ? <option value="|">No plan targets available</option> : null}
              {suggestions.map((s) => (
                <option key={`${s.planId}|${s.objectId}`} value={`${s.planId}|${s.objectId}`}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mono-label">Date seen</span>
            <input
              type="date"
              className="field mt-1"
              value={form.seenOn}
              onChange={(e) => setForm({ ...form, seenOn: e.target.value })}
              required
              data-testid="log-date"
            />
          </label>

          <label className="block">
            <span className="mono-label">Confidence ({form.confidence}/5)</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              className="mt-2 w-full"
              style={{ accentColor: "var(--color-brass-400)" }}
              value={form.confidence}
              onChange={(e) => setForm({ ...form, confidence: Number(e.target.value) })}
              data-testid="log-confidence"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mono-label">Notes</span>
            <textarea
              className="field mt-1"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Averted vision, 120x, air was steady after midnight…"
              data-testid="log-notes"
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="log-submit">
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
            Save observation
          </button>
          {error ? (
            <p role="alert" className="signal-fallback text-xs">
              {error}
            </p>
          ) : null}
        </div>
      </form>

      <h2 className="plate-caption mt-8">Entries ({items.length})</h2>
      {items.length === 0 ? (
        <p className="plate mt-3 p-4 text-sm text-bone-400" data-testid="log-empty">
          No observations recorded yet. Add the first one above.
        </p>
      ) : (
        <ul className="mt-3 space-y-2" data-testid="log-list">
          {items.map((o) => (
            <li key={o.id} className="plate p-3">
              {editing === o.id ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_6rem_auto]">
                  <input
                    className="field"
                    defaultValue={o.objectName}
                    onChange={(e) => void patch(o.id, { objectName: e.target.value })}
                    aria-label="Object name"
                  />
                  <input
                    className="field"
                    type="number"
                    min={1}
                    max={5}
                    defaultValue={o.confidence}
                    onChange={(e) => void patch(o.id, { confidence: Number(e.target.value) })}
                    aria-label="Confidence"
                  />
                  <button type="button" className="btn" onClick={() => setEditing(null)}>
                    Done
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-bone-100">{o.objectName}</p>
                    <p className="text-[0.7rem] uppercase tracking-[0.1em] text-bone-400">
                      {o.seenOn} · confidence {o.confidence}/5
                      {o.planId ? ` · plan ${o.planId.slice(0, 8)}` : ""}
                    </p>
                    {o.notes ? <p className="mt-1 text-xs text-bone-300">{o.notes}</p> : null}
                  </div>
                  <button type="button" className="btn" onClick={() => setEditing(o.id)} data-testid={`log-edit-${o.id}`}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => void remove(o.id)}
                    disabled={busy}
                    data-testid={`log-delete-${o.id}`}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}