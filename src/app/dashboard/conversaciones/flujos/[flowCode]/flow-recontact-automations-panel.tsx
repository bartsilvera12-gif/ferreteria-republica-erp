"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type {
  PurchaseCondition,
  RecontactRuleRowOut,
} from "@/lib/chat/recontact-rules-validation";

export type FlowRecontactPickerNode = {
  node_code: string;
  label: string;
};

function guardDefaults(): {
  skip_if_human_taken_over: boolean;
  skip_if_conversation_closed: boolean;
  purchase_condition: PurchaseCondition;
} {
  return {
    skip_if_human_taken_over: true,
    skip_if_conversation_closed: true,
    purchase_condition: "none",
  };
}

function parseGuard(raw: unknown): ReturnType<typeof guardDefaults> {
  const d = guardDefaults();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;
  if (typeof o.skip_if_human_taken_over === "boolean") d.skip_if_human_taken_over = o.skip_if_human_taken_over;
  if (typeof o.skip_if_conversation_closed === "boolean") d.skip_if_conversation_closed = o.skip_if_conversation_closed;
  const pc = o.purchase_condition;
  if (pc === "no_confirmed_sorteo_order" || pc === "none") d.purchase_condition = pc;
  return d;
}

type Draft = {
  nombre: string;
  descripcion: string;
  activo: boolean;
  prioridad: number;
  included_node_codes: string[];
  excluded_node_codes: string[];
  idle_after_minutes: number;
  max_attempts: number;
  cooldown_minutes: number;
  window_start: string;
  window_end: string;
  timezone: string;
  weekdays: boolean[];
  skip_human: boolean;
  skip_closed: boolean;
  purchase_condition: PurchaseCondition;
  message_type: "session_text" | "whatsapp_template";
  session_text: string;
  template_name: string;
  template_language: string;
  template_components_json: string;
  buttons_json: string;
};

function emptyDraft(): Draft {
  return {
    nombre: "",
    descripcion: "",
    activo: false,
    prioridad: 100,
    included_node_codes: [],
    excluded_node_codes: [],
    idle_after_minutes: 60,
    max_attempts: 1,
    cooldown_minutes: 1440,
    window_start: "",
    window_end: "",
    timezone: "",
    weekdays: [false, true, true, true, true, true, false],
    skip_human: true,
    skip_closed: true,
    purchase_condition: "none",
    message_type: "session_text",
    session_text: "",
    template_name: "",
    template_language: "",
    template_components_json: "{}",
    buttons_json: "[]",
  };
}

function rowToDraft(row: RecontactRuleRowOut): Draft {
  const g = parseGuard(row.guard_config);
  const sch =
    row.schedule_config && typeof row.schedule_config === "object" && !Array.isArray(row.schedule_config)
      ? (row.schedule_config as Record<string, unknown>)
      : {};
  const wd = (sch.active_weekdays as number[] | undefined) ?? [];
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((d) => wd.includes(d));
  const mc =
    row.message_config && typeof row.message_config === "object" && !Array.isArray(row.message_config)
      ? (row.message_config as Record<string, unknown>)
      : {};
  const mt = mc.message_type === "whatsapp_template" ? "whatsapp_template" : "session_text";
  let buttons_json = "[]";
  try {
    buttons_json = JSON.stringify(mc.buttons_json ?? [], null, 2);
  } catch {
    buttons_json = "[]";
  }
  let template_components_json = "{}";
  try {
    template_components_json = JSON.stringify(mc.template_components ?? {}, null, 2);
  } catch {
    template_components_json = "{}";
  }
  return {
    nombre: row.nombre,
    descripcion: row.descripcion ?? "",
    activo: row.activo,
    prioridad: row.prioridad,
    included_node_codes: Array.isArray(row.included_node_codes)
      ? (row.included_node_codes as unknown[]).map((x) => String(x))
      : [],
    excluded_node_codes: Array.isArray(row.excluded_node_codes)
      ? (row.excluded_node_codes as unknown[]).map((x) => String(x))
      : [],
    idle_after_minutes: Math.max(1, Math.round(row.idle_after_seconds / 60)),
    max_attempts: row.max_attempts,
    cooldown_minutes: Math.max(1, Math.round(row.cooldown_seconds / 60)),
    window_start: typeof sch.window_start === "string" ? sch.window_start : "",
    window_end: typeof sch.window_end === "string" ? sch.window_end : "",
    timezone: typeof sch.timezone === "string" ? sch.timezone : "",
    weekdays,
    skip_human: g.skip_if_human_taken_over,
    skip_closed: g.skip_if_conversation_closed,
    purchase_condition: g.purchase_condition,
    message_type: mt,
    session_text: typeof mc.session_text === "string" ? mc.session_text : "",
    template_name: typeof mc.template_name === "string" ? mc.template_name : "",
    template_language: typeof mc.template_language === "string" ? mc.template_language : "",
    template_components_json,
    buttons_json,
  };
}

function draftToPayload(d: Draft): Record<string, unknown> {
  const active_weekdays = d.weekdays.map((on, i) => (on ? i : null)).filter((x): x is number => x !== null);
  let buttonsParsed: unknown = [];
  try {
    buttonsParsed = JSON.parse(d.buttons_json || "[]") as unknown;
    if (!Array.isArray(buttonsParsed)) buttonsParsed = [];
  } catch {
    buttonsParsed = [];
  }
  let template_components: unknown = {};
  try {
    template_components = JSON.parse(d.template_components_json || "{}") as unknown;
  } catch {
    template_components = {};
  }
  const message_config =
    d.message_type === "session_text"
      ? {
          message_type: "session_text",
          session_text: d.session_text,
          buttons_json: buttonsParsed,
        }
      : {
          message_type: "whatsapp_template",
          template_name: d.template_name.trim(),
          template_language: d.template_language.trim(),
          template_components,
          buttons_json: buttonsParsed,
        };

  return {
    nombre: d.nombre.trim(),
    descripcion: d.descripcion.trim() || null,
    activo: d.activo,
    prioridad: d.prioridad,
    included_node_codes: d.included_node_codes,
    excluded_node_codes: d.excluded_node_codes,
    idle_after_minutes: d.idle_after_minutes,
    max_attempts: d.max_attempts,
    cooldown_minutes: d.cooldown_minutes,
    schedule_config: {
      window_start: d.window_start.trim() || null,
      window_end: d.window_end.trim() || null,
      timezone: d.timezone.trim() || null,
      active_weekdays: active_weekdays.length ? active_weekdays : null,
    },
    guard_config: {
      skip_if_human_taken_over: d.skip_human,
      skip_if_conversation_closed: d.skip_closed,
      purchase_condition: d.purchase_condition,
    },
    message_config,
  };
}

const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function FlowRecontactAutomationsPanel(props: {
  flowCode: string;
  nodePickerOptions: FlowRecontactPickerNode[];
}) {
  const { flowCode, nodePickerOptions } = props;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [items, setItems] = useState<RecontactRuleRowOut[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());

  const baseUrl = useMemo(
    () => `/api/chat/flows/${encodeURIComponent(flowCode)}/recontact-rules`,
    [flowCode]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(baseUrl);
      const json = (await res.json()) as { ok?: boolean; items?: RecontactRuleRowOut[]; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo cargar");
      setItems(json.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setModalOpen(true);
    setError(null);
  }

  function openEdit(row: RecontactRuleRowOut) {
    setEditingId(row.id);
    setDraft(rowToDraft(row));
    setModalOpen(true);
    setError(null);
  }

  async function saveDraft() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = draftToPayload(draft);
      if (String(payload.nombre ?? "").trim().length < 2) throw new Error("El nombre es obligatorio.");
      const url = editingId ? `${baseUrl}/${encodeURIComponent(editingId)}` : baseUrl;
      const method = editingId ? "PATCH" : "POST";
      const res = await fetchWithSupabaseSession(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo guardar");
      setSuccess(editingId ? "Automatización actualizada." : "Automatización creada.");
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActivo(row: RecontactRuleRowOut, activo: boolean) {
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(`${baseUrl}/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ activo }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo actualizar");
      setSuccess(activo ? "Automatización activada." : "Automatización desactivada.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  async function removeRule(row: RecontactRuleRowOut) {
    if (!window.confirm(`¿Eliminar la automatización «${row.nombre}»?`)) return;
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(`${baseUrl}/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo eliminar");
      setSuccess("Automatización eliminada.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  function toggleNode(list: "included" | "excluded", code: string) {
    setDraft((d) => {
      const key = list === "included" ? "included_node_codes" : "excluded_node_codes";
      const other = list === "included" ? "excluded_node_codes" : "included_node_codes";
      const cur = new Set(d[key]);
      const oth = new Set(d[other]);
      if (cur.has(code)) cur.delete(code);
      else {
        cur.add(code);
        oth.delete(code);
      }
      return {
        ...d,
        [key]: [...cur],
        [other]: [...oth],
      };
    });
  }

  const msgLabel = (row: RecontactRuleRowOut) => {
    const mc = row.message_config as Record<string, unknown> | null | undefined;
    const t = mc?.message_type === "whatsapp_template" ? "Plantilla WhatsApp" : "Texto de sesión";
    return t;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">Automatizaciones</h2>
        <p className="text-sm text-slate-600 mt-1">
          Configurá recontactos automáticos para clientes que quedan detenidos en este flujo.
        </p>
        <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2 text-sm text-sky-900">
          <strong className="font-medium">Simulación (FASE 1)</strong>
          <p className="mt-1 text-sky-900/90">
            Esta automatización todavía no envía mensajes. En fases futuras el sistema buscará conversaciones detenidas
            en estos nodos después del tiempo configurado.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openCreate()}
          className="mt-4 bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          Nueva automatización
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2 whitespace-pre-wrap">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">{success}</div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-600">No hay automatizaciones configuradas para este flujo.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Activo</th>
                <th className="px-3 py-2">Nodos</th>
                <th className="px-3 py-2">Espera</th>
                <th className="px-3 py-2">Intentos</th>
                <th className="px-3 py-2">Cooldown</th>
                <th className="px-3 py-2">Mensaje</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-medium text-slate-800">{row.nombre}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void toggleActivo(row, !row.activo)}
                      className={`text-xs font-semibold px-2 py-1 rounded-full border ${
                        row.activo
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                    >
                      {row.activo ? "Activo" : "Inactivo"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-slate-600 max-w-[14rem] truncate" title={JSON.stringify(row.included_node_codes)}>
                    {Array.isArray(row.included_node_codes) && row.included_node_codes.length > 0
                      ? (row.included_node_codes as string[]).join(", ")
                      : "Todos los nodos"}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{Math.round(row.idle_after_seconds / 60)} min</td>
                  <td className="px-3 py-2 text-slate-600">{row.max_attempts}</td>
                  <td className="px-3 py-2 text-slate-600">{Math.round(row.cooldown_seconds / 60)} min</td>
                  <td className="px-3 py-2 text-slate-600">{msgLabel(row)}</td>
                  <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      className="text-[#0EA5E9] hover:underline text-xs font-medium"
                      onClick={() => openEdit(row)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-red-600 hover:underline text-xs font-medium"
                      onClick={() => void removeRule(row)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 border border-slate-200">
            <div className="flex justify-between items-start gap-2">
              <h3 className="text-lg font-semibold text-slate-800">
                {editingId ? "Editar automatización" : "Nueva automatización"}
              </h3>
              <button type="button" className="text-slate-400 hover:text-slate-700 text-xl leading-none" onClick={() => setModalOpen(false)}>
                ×
              </button>
            </div>

            <label className="block text-xs text-slate-500 mb-1">Nombre</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={draft.nombre}
              onChange={(e) => setDraft((d) => ({ ...d, nombre: e.target.value }))}
              placeholder="Ej.: Recordatorio sin respuesta"
            />

            <label className="block text-xs text-slate-500 mb-1">Descripción</label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[72px]"
              value={draft.descripcion}
              onChange={(e) => setDraft((d) => ({ ...d, descripcion: e.target.value }))}
            />

            <div className="flex flex-wrap gap-4 items-center">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.activo}
                  onChange={(e) => setDraft((d) => ({ ...d, activo: e.target.checked }))}
                />
                Activo
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Prioridad</span>
                <input
                  type="number"
                  className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-sm"
                  value={draft.prioridad}
                  onChange={(e) => setDraft((d) => ({ ...d, prioridad: Number(e.target.value) || 0 }))}
                />
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-600 mb-2">Nodos incluidos (vacío = cualquier nodo del flujo)</p>
              <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                {nodePickerOptions.map((n) => (
                  <label key={n.node_code} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.included_node_codes.includes(n.node_code)}
                      onChange={() => toggleNode("included", n.node_code)}
                    />
                    <span className="font-mono text-xs text-slate-600">{n.node_code}</span>
                    <span className="text-slate-700 truncate">{n.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-600 mb-2">Nodos excluidos</p>
              <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                {nodePickerOptions.map((n) => (
                  <label key={`ex-${n.node_code}`} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.excluded_node_codes.includes(n.node_code)}
                      onChange={() => toggleNode("excluded", n.node_code)}
                    />
                    <span className="font-mono text-xs text-slate-600">{n.node_code}</span>
                    <span className="text-slate-700 truncate">{n.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Inactividad (min)</label>
                <input
                  type="number"
                  min={1}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={draft.idle_after_minutes}
                  onChange={(e) => setDraft((d) => ({ ...d, idle_after_minutes: Number(e.target.value) || 1 }))}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Máx. intentos</label>
                <input
                  type="number"
                  min={1}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={draft.max_attempts}
                  onChange={(e) => setDraft((d) => ({ ...d, max_attempts: Math.max(1, Number(e.target.value) || 1) }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-500 mb-1">Cooldown entre intentos (min)</label>
                <input
                  type="number"
                  min={1}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={draft.cooldown_minutes}
                  onChange={(e) => setDraft((d) => ({ ...d, cooldown_minutes: Math.max(1, Number(e.target.value) || 1) }))}
                />
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-2">
              <p className="text-xs font-semibold text-slate-700">Ventana horaria (opcional)</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500">Desde (HH:mm)</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                    placeholder="09:00"
                    value={draft.window_start}
                    onChange={(e) => setDraft((d) => ({ ...d, window_start: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Hasta</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                    placeholder="18:00"
                    value={draft.window_end}
                    onChange={(e) => setDraft((d) => ({ ...d, window_end: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500">Zona horaria (opcional)</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                  placeholder="America/Asuncion"
                  value={draft.timezone}
                  onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {WEEKDAY_LABELS.map((lb, i) => (
                  <label key={lb} className="inline-flex items-center gap-1 text-xs border border-slate-200 rounded px-2 py-1">
                    <input
                      type="checkbox"
                      checked={draft.weekdays[i] ?? false}
                      onChange={(e) =>
                        setDraft((d) => {
                          const w = [...d.weekdays];
                          w[i] = e.target.checked;
                          return { ...d, weekdays: w };
                        })
                      }
                    />
                    {lb}
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-2">
              <p className="text-xs font-semibold text-slate-700">Condiciones</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.skip_human}
                  onChange={(e) => setDraft((d) => ({ ...d, skip_human: e.target.checked }))}
                />
                No enviar si un humano tomó la conversación (human_taken_over)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.skip_closed}
                  onChange={(e) => setDraft((d) => ({ ...d, skip_closed: e.target.checked }))}
                />
                No enviar si la conversación está cerrada
              </label>
              <div>
                <label className="text-xs text-slate-500">Compra / orden sorteo</label>
                <select
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={draft.purchase_condition}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      purchase_condition: e.target.value as PurchaseCondition,
                    }))
                  }
                >
                  <option value="none">Sin filtro adicional</option>
                  <option value="no_confirmed_sorteo_order">Solo si no hay orden sorteo confirmada</option>
                </select>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-2">
              <p className="text-xs font-semibold text-slate-700">Mensaje (solo configuración; sin envío)</p>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                value={draft.message_type}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    message_type: e.target.value as "session_text" | "whatsapp_template",
                  }))
                }
              >
                <option value="session_text">Texto de sesión</option>
                <option value="whatsapp_template">Plantilla WhatsApp</option>
              </select>
              {draft.message_type === "session_text" ? (
                <textarea
                  className="w-full min-h-[88px] border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Texto que se usará en una fase futura como mensaje de sesión."
                  value={draft.session_text}
                  onChange={(e) => setDraft((d) => ({ ...d, session_text: e.target.value }))}
                />
              ) : (
                <div className="space-y-2">
                  <input
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="Nombre plantilla"
                    value={draft.template_name}
                    onChange={(e) => setDraft((d) => ({ ...d, template_name: e.target.value }))}
                  />
                  <input
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="Idioma (ej. es)"
                    value={draft.template_language}
                    onChange={(e) => setDraft((d) => ({ ...d, template_language: e.target.value }))}
                  />
                  <label className="text-xs text-slate-500">Components (JSON)</label>
                  <textarea
                    className="w-full min-h-[72px] font-mono text-xs border border-slate-200 rounded-lg px-2 py-1"
                    value={draft.template_components_json}
                    onChange={(e) => setDraft((d) => ({ ...d, template_components_json: e.target.value }))}
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-slate-500">Botones / acciones futuras (JSON)</label>
                <textarea
                  className="w-full min-h-[64px] font-mono text-xs border border-slate-200 rounded-lg px-2 py-1"
                  value={draft.buttons_json}
                  onChange={(e) => setDraft((d) => ({ ...d, buttons_json: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                onClick={() => setModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-[#0EA5E9] text-white hover:bg-[#0284C7] disabled:opacity-50"
                onClick={() => void saveDraft()}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
