"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type FlowNodeOption = {
  id: string;
  node_id: string;
  label: string;
  option_value: string;
  meta_button_id: string;
  next_node_code: string | null;
  sort_order: number;
};

type FlowNode = {
  id: string;
  node_code: string;
  node_type: string;
  message_text: string | null;
  save_as_field: string | null;
  next_node_code: string | null;
  is_active: boolean;
  crm_action_type: string | null;
  crm_action_config: Record<string, unknown>;
  options: FlowNodeOption[];
};

export default function FlowEditorPage() {
  const params = useParams<{ flowCode: string }>();
  const flowCode = decodeURIComponent(params?.flowCode ?? "");
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newNodeCode, setNewNodeCode] = useState("");
  const [newNodeType, setNewNodeType] = useState("text");

  const nodeCodes = useMemo(() => nodes.map((n) => n.node_code), [nodes]);

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/flows/${encodeURIComponent(flowCode)}/nodes`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: FlowNode[];
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo cargar nodos");
      setNodes(json.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [flowCode]);

  async function createNode(e: React.FormEvent) {
    e.preventDefault();
    if (!newNodeCode.trim()) return;
    setError(null);
    try {
      const res = await fetch(`/api/chat/flows/${encodeURIComponent(flowCode)}/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          node_code: newNodeCode.trim(),
          node_type: newNodeType,
          message_text: "",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo crear nodo");
      setNewNodeCode("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando nodo");
    }
  }

  async function saveNode(node: FlowNode) {
    setError(null);
    const res = await fetch(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          node_type: node.node_type,
          message_text: node.message_text ?? "",
          save_as_field: node.save_as_field ?? null,
          next_node_code: node.next_node_code ?? null,
          is_active: node.is_active,
          crm_action_type: node.crm_action_type ?? null,
          crm_action_config: node.crm_action_config ?? {},
        }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo guardar nodo");
  }

  async function saveOption(node: FlowNode, opt: FlowNodeOption) {
    const res = await fetch(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}/options/${opt.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          label: opt.label,
          meta_button_id: opt.meta_button_id,
          next_node_code: opt.next_node_code,
          sort_order: opt.sort_order,
        }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo guardar opción");
  }

  async function createOption(node: FlowNode) {
    const res = await fetch(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}/options`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          label: "Nueva opción",
          meta_button_id: `btn_${Date.now()}`,
          next_node_code: null,
          sort_order: node.options.length + 1,
        }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo crear opción");
  }

  async function deleteOption(node: FlowNode, optionId: string) {
    const res = await fetch(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}/options/${optionId}`,
      { method: "DELETE", credentials: "same-origin" }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo eliminar opción");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Editor de flujo: {flowCode}</h1>
          <p className="text-sm text-slate-500">Nodos + opciones de botones + preparación CRM</p>
        </div>
        <Link
          href="/dashboard/conversaciones/flujos"
          className="text-sm font-medium text-[#0EA5E9] hover:underline px-3 py-2 rounded-lg border border-sky-200 bg-sky-50"
        >
          Volver al listado
        </Link>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}

      <form onSubmit={createNode} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-slate-500 mb-1">node_code</label>
          <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={newNodeCode} onChange={(e) => setNewNodeCode(e.target.value)} />
        </div>
        <div className="min-w-[180px]">
          <label className="block text-xs text-slate-500 mb-1">node_type</label>
          <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={newNodeType} onChange={(e) => setNewNodeType(e.target.value)}>
            <option value="buttons">buttons</option>
            <option value="list">list</option>
            <option value="text">text</option>
            <option value="image_input">image_input</option>
            <option value="human">human</option>
            <option value="end">end</option>
          </select>
        </div>
        <button type="submit" className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium">Crear nodo</button>
      </form>

      {loading ? (
        <div className="p-6 text-sm text-slate-400 animate-pulse">Cargando nodos...</div>
      ) : (
        <div className="space-y-4">
          {nodes.map((node, idx) => (
            <div key={node.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-700">Nodo #{idx + 1}: {node.node_code}</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" value={node.node_code} readOnly />
                <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={node.node_type} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, node_type: e.target.value } : n))}>
                  <option value="buttons">buttons</option>
                  <option value="list">list</option>
                  <option value="text">text</option>
                  <option value="image_input">image_input</option>
                  <option value="human">human</option>
                  <option value="end">end</option>
                </select>
                <label className="text-sm text-slate-700 flex items-center gap-2">
                  <input type="checkbox" checked={node.is_active} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, is_active: e.target.checked } : n))} />
                  Activo
                </label>
              </div>
              <textarea className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[74px]" placeholder="message_text" value={node.message_text ?? ""} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, message_text: e.target.value } : n))} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="save_as_field" value={node.save_as_field ?? ""} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, save_as_field: e.target.value || null } : n))} />
                <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={node.next_node_code ?? ""} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, next_node_code: e.target.value || null } : n))}>
                  <option value="">(sin siguiente nodo)</option>
                  {nodeCodes.filter((code) => code !== node.node_code).map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
                <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="crm_action_type (prep CRM)" value={node.crm_action_type ?? ""} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, crm_action_type: e.target.value || null } : n))} />
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await saveNode(node);
                    await reload();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Error al guardar nodo");
                  }
                }}
                className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Guardar nodo
              </button>

              {node.node_type === "buttons" && (
                <div className="border border-slate-100 rounded-lg p-3 space-y-2 bg-slate-50/60">
                  <div className="text-xs font-semibold text-slate-600 uppercase">Opciones / Botones</div>
                  {node.options.map((opt) => (
                    <div key={opt.id} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
                      <input className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm" value={opt.label} onChange={(e) => setNodes((prev) => prev.map((n) => n.id !== node.id ? n : ({ ...n, options: n.options.map((o) => o.id === opt.id ? { ...o, label: e.target.value } : o) } )))} placeholder="label" />
                      <input className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono" value={opt.meta_button_id} onChange={(e) => setNodes((prev) => prev.map((n) => n.id !== node.id ? n : ({ ...n, options: n.options.map((o) => o.id === opt.id ? { ...o, meta_button_id: e.target.value } : o) } )))} placeholder="meta_button_id" />
                      <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm" value={opt.next_node_code ?? ""} onChange={(e) => setNodes((prev) => prev.map((n) => n.id !== node.id ? n : ({ ...n, options: n.options.map((o) => o.id === opt.id ? { ...o, next_node_code: e.target.value || null } : o) } )))} >
                        <option value="">(sin siguiente)</option>
                        {nodeCodes.filter((code) => code !== node.node_code).map((code) => (
                          <option key={code} value={code}>{code}</option>
                        ))}
                      </select>
                      <input type="number" className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm" value={opt.sort_order} onChange={(e) => setNodes((prev) => prev.map((n) => n.id !== node.id ? n : ({ ...n, options: n.options.map((o) => o.id === opt.id ? { ...o, sort_order: Number(e.target.value) || 0 } : o) } )))} />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await saveOption(node, opt);
                              await reload();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Error al guardar opción");
                            }
                          }}
                          className="text-[#0EA5E9] hover:underline text-sm"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await deleteOption(node, opt.id);
                              await reload();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Error al eliminar opción");
                            }
                          }}
                          className="text-red-600 hover:underline text-sm"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await createOption(node);
                        await reload();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Error al crear opción");
                      }
                    }}
                    className="text-sm text-[#0EA5E9] hover:underline"
                  >
                    + Agregar opción
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
