"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type FlowRow = {
  id: string;
  flow_code: string;
  label: string | null;
  channel: string;
  activo: boolean;
  node_count: number;
  updated_at: string;
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-PY", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function FlowsListPage() {
  const [rows, setRows] = useState<FlowRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [duplicateFrom, setDuplicateFrom] = useState("");

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch("/api/chat/flows", { credentials: "same-origin", cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: FlowRow[];
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Error al cargar flujos");
      setRows(json.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar flujos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          flow_code: newCode.trim(),
          label: newLabel.trim() || newCode.trim(),
          duplicate_from: duplicateFrom.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Error al crear flujo");
      setNewCode("");
      setNewLabel("");
      setDuplicateFrom("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear flujo");
    } finally {
      setCreating(false);
    }
  }

  async function toggleFlow(flowCode: string, activo: boolean) {
    try {
      const res = await fetch(`/api/chat/flows/${encodeURIComponent(flowCode)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ activo: !activo }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo actualizar estado");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al actualizar estado");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Flujos conversacionales</h1>
          <p className="text-sm text-slate-500">Administración simple de flujos WhatsApp por empresa</p>
        </div>
        <Link
          href="/dashboard/conversaciones"
          className="text-sm font-medium text-[#0EA5E9] hover:underline px-3 py-2 rounded-lg border border-sky-200 bg-sky-50"
        >
          Volver a conversaciones
        </Link>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}

      <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          placeholder="flow_code (ej: sorteo_default)"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
        />
        <input
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          placeholder="label visible"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <input
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          placeholder="duplicar de (opcional)"
          value={duplicateFrom}
          onChange={(e) => setDuplicateFrom(e.target.value)}
        />
        <button
          type="submit"
          disabled={creating}
          className="bg-[#0EA5E9] hover:bg-[#0284C7] disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          {creating ? "Creando..." : "Crear flujo"}
        </button>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-700">Listado</div>
        {loading ? (
          <div className="p-6 text-sm text-slate-400 animate-pulse">Cargando...</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No hay flujos creados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2">flow_code</th>
                  <th className="text-left px-4 py-2">nombre</th>
                  <th className="text-left px-4 py-2">canal</th>
                  <th className="text-left px-4 py-2">estado</th>
                  <th className="text-left px-4 py-2">nodos</th>
                  <th className="text-left px-4 py-2">actualizado</th>
                  <th className="text-left px-4 py-2">acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono">{r.flow_code}</td>
                    <td className="px-4 py-2">{r.label || r.flow_code}</td>
                    <td className="px-4 py-2">{r.channel}</td>
                    <td className="px-4 py-2">
                      {r.activo ? <span className="text-emerald-600">Activo</span> : <span className="text-amber-600">Inactivo</span>}
                    </td>
                    <td className="px-4 py-2">{r.node_count}</td>
                    <td className="px-4 py-2">{fmt(r.updated_at)}</td>
                    <td className="px-4 py-2 flex gap-3">
                      <Link href={`/dashboard/conversaciones/flujos/${encodeURIComponent(r.flow_code)}`} className="text-[#0EA5E9] hover:underline">
                        Editar
                      </Link>
                      <button type="button" onClick={() => void toggleFlow(r.flow_code, r.activo)} className="text-slate-600 hover:underline">
                        {r.activo ? "Desactivar" : "Activar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDuplicateFrom(r.flow_code);
                          setNewCode(`${r.flow_code}_copy`);
                          setNewLabel(`${r.label || r.flow_code} (copia)`);
                        }}
                        className="text-slate-600 hover:underline"
                      >
                        Duplicar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
