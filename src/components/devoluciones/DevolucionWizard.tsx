"use client";

/**
 * Wizard de devolución de venta en 3 pasos:
 *   1) Productos a devolver (cantidad + vuelve al stock / dañado)
 *   2) Resolución (cambio por otro producto / devolver el dinero) + método
 *   3) Confirmación (resumen completo) -> POST /api/devoluciones
 *
 * La `idempotency_key` se genera una sola vez al abrir: un doble clic en
 * "Confirmar devolución" no puede crear dos devoluciones.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Loader2, Plus, Minus, Check } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type {
  CondicionProducto, MetodoReembolso, ResolucionDevolucion, VentaDevolvible,
} from "@/lib/devoluciones/types";

/** Cliente al que acreditar el saldo (ventas de mostrador no traen cliente). */
type ClienteHit = { id: string; nombre: string; ruc: string | null };

function gs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}

interface Props {
  ventaId: string;
  onClose: () => void;
  onDone: (devolucionId: string) => void;
}

export default function DevolucionWizard({ ventaId, onClose, onDone }: Props) {
  const [venta, setVenta] = useState<VentaDevolvible | null>(null);
  const [cargando, setCargando] = useState(true);
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Paso 1
  const [cant, setCant] = useState<Record<string, number>>({});
  const [cond, setCond] = useState<Record<string, CondicionProducto>>({});
  // Paso 2
  const [resolucion, setResolucion] = useState<ResolucionDevolucion>("reembolso");
  const [metodo, setMetodo] = useState<MetodoReembolso>("efectivo");
  const [motivo, setMotivo] = useState("");
  // Cliente al que se acredita el saldo (solo si la venta no tiene uno).
  const [clienteSel, setClienteSel] = useState<ClienteHit | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClienteHit[]>([]);
  const [buscando, setBuscando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clave estable: doble clic -> misma devolución.
  const idemKey = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.round(Math.random() * 1e9)}`
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/ventas/${ventaId}/devolucion`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j?.success === false) { setError(j?.error ?? "No se pudo cargar la venta."); return; }
      setVenta(j.data.venta as VentaDevolvible);
    } catch { setError("Error de red al cargar la venta."); }
    finally { setCargando(false); }
  }, [ventaId]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Autocomplete de clientes (solo se usa si hay que elegir a quién acreditar).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) { setHits([]); setBuscando(false); return; }
    setBuscando(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetchWithSupabaseSession("/api/clientes", { cache: "no-store" });
        const j = await r.json();
        const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
        const todos = (Array.isArray(j?.data) ? j.data : []) as Record<string, unknown>[];
        setHits(
          todos
            .map((c): ClienteHit => ({
              id: String(c.id),
              nombre: s(c.empresa) || s(c.nombre_contacto) || s(c.nombre) || "Cliente",
              ruc: s(c.ruc) || s(c.documento),
            }))
            .filter((c) => productoMatchesQuery(term, c.nombre, c.ruc))
            .slice(0, 15)
        );
      } catch { setHits([]); }
      finally { setBuscando(false); }
    }, 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  const lineas = useMemo(() => venta?.lineas ?? [], [venta]);
  const seleccion = useMemo(
    () => lineas.filter((l) => (cant[l.venta_item_id] ?? 0) > 0),
    [lineas, cant]
  );
  const totalDevuelto = useMemo(
    () => seleccion.reduce((a, l) => a + l.precio_unitario * (cant[l.venta_item_id] ?? 0), 0),
    [seleccion, cant]
  );
  /** Saldo a favor NO mueve caja: el monto queda como crédito del cliente. */
  const esSaldo = resolucion === "saldo_favor";
  const diferencia = esSaldo ? 0 : -totalDevuelto;
  /** La venta ya tiene cliente: no hace falta elegir uno. */
  const clienteVenta = venta?.cliente_id ? { id: venta.cliente_id, nombre: venta.cliente_nombre ?? "Cliente" } : null;
  const clienteCredito = clienteVenta ?? clienteSel;

  const unidadesTotales = useMemo(
    () => seleccion.reduce((a, l) => a + (cant[l.venta_item_id] ?? 0), 0),
    [seleccion, cant]
  );
  /** Todas las líneas con stock disponible están marcadas. */
  const todoSeleccionado = useMemo(() => {
    const dispo = lineas.filter((l) => l.cantidad_disponible > 0);
    return dispo.length > 0 && dispo.every((l) => (cant[l.venta_item_id] ?? 0) > 0);
  }, [lineas, cant]);

  function setCantidad(id: string, v: number, max: number) {
    const n = Math.max(1, Math.min(max, Number.isFinite(v) ? v : 1));
    setCant((p) => ({ ...p, [id]: n }));
  }
  /** Marca (con la cantidad disponible completa) o desmarca una línea. */
  function toggleLinea(id: string, disponible: number) {
    setCant((p) => {
      const next = { ...p };
      if ((next[id] ?? 0) > 0) delete next[id];
      else next[id] = disponible;
      return next;
    });
  }
  /** Marca todo lo devolvible, o limpia la selección si ya estaba todo marcado. */
  function devolverTodo() {
    if (todoSeleccionado) { setCant({}); return; }
    const next: Record<string, number> = {};
    for (const l of lineas) if (l.cantidad_disponible > 0) next[l.venta_item_id] = l.cantidad_disponible;
    setCant(next);
  }
  async function confirmar() {
    if (guardando) return; // guard anti doble clic (además de la idempotency_key)
    setGuardando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/devoluciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venta_id: ventaId,
          motivo: motivo.trim() || null,
          resolucion,
          metodo,
          idempotency_key: idemKey.current,
          items: seleccion.map((l) => ({
            venta_item_id: l.venta_item_id,
            cantidad: cant[l.venta_item_id],
            condicion: cond[l.venta_item_id] ?? "buen_estado",
            reintegra_stock: (cond[l.venta_item_id] ?? "buen_estado") === "buen_estado",
          })),
          cambios: [],
          cliente_id: esSaldo ? clienteCredito?.id ?? null : null,
        }),
      });
      const j = await r.json();
      if (!r.ok || j?.success === false) { setError(j?.error ?? "No se pudo confirmar la devolución."); return; }
      onDone(String(j.data.devolucion.id));
    } catch { setError("Error de red al confirmar."); }
    finally { setGuardando(false); }
  }

  const puedePaso2 = seleccion.length > 0;
  // Con saldo a favor hace falta un cliente a quien acreditarle el crédito.
  const puedeConfirmar = puedePaso2 && (!esSaldo || !!clienteCredito);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Devolución de venta</h2>
            <p className="text-sm text-slate-500">
              {venta ? `Venta ${venta.numero_control}${venta.cliente_nombre ? ` · ${venta.cliente_nombre}` : ""}` : "Cargando…"}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Pasos */}
        <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-3">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="flex flex-1 items-center gap-2">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                paso >= n ? "bg-[#4FAEB2] text-white" : "bg-slate-100 text-slate-400"}`}>{n}</span>
              <span className={`text-xs font-semibold ${paso >= n ? "text-slate-800" : "text-slate-400"}`}>
                {n === 1 ? "Productos" : n === 2 ? "Resolución" : "Confirmación"}
              </span>
              {n < 3 && <div className={`h-0.5 flex-1 ${paso > n ? "bg-[#4FAEB2]" : "bg-slate-100"}`} />}
            </div>
          ))}
        </div>

        <div className="px-6 py-5">
          {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          {cargando ? (
            <p className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando venta…</p>
          ) : !venta ? (
            <p className="py-8 text-sm text-slate-500">No se pudo cargar la venta.</p>
          ) : paso === 1 ? (
            /* ── PASO 1 ── */
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">Marcá los productos que devuelve el cliente.</p>
                <button onClick={devolverTodo} className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-3 py-1.5 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/[0.16]">
                  {todoSeleccionado ? "Quitar selección" : "Devolver toda la venta"}
                </button>
              </div>

              {lineas.map((l) => {
                const c = cant[l.venta_item_id] ?? 0;
                const cd = cond[l.venta_item_id] ?? "buen_estado";
                const agotada = l.cantidad_disponible <= 0;
                const marcada = c > 0;
                return (
                  <div key={l.venta_item_id}
                    className={`rounded-xl border-2 transition-colors ${
                      agotada ? "border-slate-100 bg-slate-50" : marcada ? "border-[#4FAEB2] bg-[#4FAEB2]/[0.04]" : "border-slate-200"}`}>
                    {/* Cabecera: toda la fila es clickeable para marcar/desmarcar */}
                    <button type="button" disabled={agotada} onClick={() => toggleLinea(l.venta_item_id, l.cantidad_disponible)}
                      className="flex w-full items-start gap-3 p-3 text-left disabled:cursor-not-allowed">
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                        agotada ? "border-slate-200 bg-slate-100" : marcada ? "border-[#4FAEB2] bg-[#4FAEB2] text-white" : "border-slate-300 bg-white"}`}>
                        {marcada && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-semibold ${agotada ? "text-slate-400" : "text-slate-800"}`}>{l.producto_nombre}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {l.sku && <span className="font-mono">{l.sku} · </span>}{gs(l.precio_unitario)} c/u
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                          <span className="text-slate-500">Vendido: <strong className="text-slate-700">{l.cantidad_vendida}</strong></span>
                          {l.cantidad_devuelta > 0 && <span className="text-slate-500">Ya devuelto: <strong className="text-amber-700">{l.cantidad_devuelta}</strong></span>}
                          <span className={agotada ? "text-slate-400" : "text-emerald-700"}>
                            Disponible: <strong>{l.cantidad_disponible}</strong>
                          </span>
                          {agotada && <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-500">Ya devuelto por completo</span>}
                        </span>
                      </span>
                    </button>

                    {/* Al marcar: cantidad + condición */}
                    {marcada && (
                      <div className="space-y-3 border-t border-[#4FAEB2]/20 px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-600">Cantidad a devolver</span>
                            <div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                              <button type="button" aria-label="Restar"
                                onClick={() => setCantidad(l.venta_item_id, c - 1, l.cantidad_disponible)}
                                disabled={c <= 1}
                                className="flex h-8 w-8 items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30">
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <input type="number" min={1} max={l.cantidad_disponible} step="any" value={c}
                                onChange={(e) => setCantidad(l.venta_item_id, Number(e.target.value), l.cantidad_disponible)}
                                className="h-8 w-14 border-x border-slate-200 text-center text-sm font-bold text-slate-800 outline-none focus:bg-[#4FAEB2]/[0.06]" />
                              <button type="button" aria-label="Sumar"
                                onClick={() => setCantidad(l.venta_item_id, c + 1, l.cantidad_disponible)}
                                disabled={c >= l.cantidad_disponible}
                                className="flex h-8 w-8 items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30">
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <span className="text-xs text-slate-400">de {l.cantidad_disponible}</span>
                          </div>
                          <span className="text-sm font-bold text-slate-800">{gs(l.precio_unitario * c)}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(["buen_estado", "danado"] as const).map((op) => (
                            <button key={op} type="button"
                              onClick={() => setCond((p) => ({ ...p, [l.venta_item_id]: op }))}
                              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                                cd === op
                                  ? op === "danado" ? "border-red-300 bg-red-50 text-red-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                              {op === "buen_estado" ? "✓ Vuelve al stock" : "✕ Dañado / no vuelve al stock"}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-sm text-slate-500">
                  {seleccion.length === 0 ? "Ningún producto seleccionado" : `${seleccion.length} producto(s) · ${unidadesTotales} unidad(es)`}
                </span>
                <span className="text-lg font-bold text-[#3F8E91]">{gs(totalDevuelto)}</span>
              </div>
            </div>
          ) : paso === 2 ? (
            /* ── PASO 2 ── */
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([
                  ["saldo_favor", "Generar saldo a favor", "Queda como crédito del cliente para su próxima compra."],
                  ["reembolso", "Devolver el dinero", "Se le entrega el importe y la devolución termina acá."],
                ] as const).map(([val, label, hint]) => (
                  <button key={val} type="button" onClick={() => setResolucion(val)}
                    className={`rounded-xl border-2 p-4 text-left transition-colors ${
                      resolucion === val ? "border-[#4FAEB2] bg-[#4FAEB2]/[0.08]" : "border-slate-200 hover:bg-slate-50"}`}>
                    <span className={`block text-sm font-bold ${resolucion === val ? "text-[#3F8E91]" : "text-slate-700"}`}>{label}</span>
                    <span className="mt-1 block text-xs leading-snug text-slate-500">{hint}</span>
                  </button>
                ))}
              </div>

              {/* Saldo a favor: hace falta un cliente a quien acreditárselo. */}
              {esSaldo && (
                clienteVenta ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                    <Check className="h-4 w-4 shrink-0" />
                    <span>El saldo se acredita a <strong>{clienteVenta.nombre}</strong> (cliente de la venta).</span>
                  </div>
                ) : clienteSel ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                    <Check className="h-4 w-4 shrink-0" />
                    <span className="flex-1">El saldo se acredita a <strong>{clienteSel.nombre}</strong>{clienteSel.ruc ? ` · ${clienteSel.ruc}` : ""}.</span>
                    <button type="button" onClick={() => { setClienteSel(null); setQ(""); }}
                      className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-semibold hover:bg-emerald-100">Cambiar</button>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm text-amber-800">
                      Esta venta no tiene cliente. Elegí a quién acreditarle el saldo a favor.
                    </p>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4FAEB2]" />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente por nombre o RUC…"
                        className="h-11 w-full rounded-lg border-2 border-[#4FAEB2]/30 bg-white pl-10 pr-3 text-sm outline-none focus:border-[#4FAEB2]" />
                      {q.trim().length >= 2 && (
                        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                          {buscando && hits.length === 0 ? (
                            <p className="px-3 py-3 text-center text-xs text-slate-400">Buscando…</p>
                          ) : hits.length === 0 ? (
                            <p className="px-3 py-3 text-center text-xs text-slate-400">Sin clientes que coincidan.</p>
                          ) : hits.map((h) => (
                            <button key={h.id} type="button" onClick={() => { setClienteSel(h); setQ(""); setHits([]); }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-slate-800">{h.nombre}</p>
                                {h.ruc && <p className="text-xs text-slate-400">RUC / CI: {h.ruc}</p>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}

              {/* Resumen económico */}
              <div className="space-y-1 rounded-xl bg-slate-50 p-4 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Valor devuelto</span><span className="tabular-nums font-medium">{gs(totalDevuelto)}</span></div>
                <div className={`flex justify-between border-t border-slate-200 pt-1.5 font-bold ${esSaldo ? "text-[#3F8E91]" : "text-[#3F8E91]"}`}>
                  <span>{esSaldo ? "Saldo a favor a generar" : "A devolver al cliente"}</span>
                  <span className="tabular-nums">{gs(totalDevuelto)}</span>
                </div>
              </div>

              {diferencia !== 0 && (
                <div>
                  <label className="text-xs font-semibold text-slate-600">Método {diferencia > 0 ? "de cobro" : "del reembolso"}</label>
                  <div className="mt-1 flex gap-2">
                    {(["efectivo", "transferencia", "tarjeta"] as const).map((m) => (
                      <button key={m} type="button" onClick={() => setMetodo(m)}
                        className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition-colors ${
                          metodo === m ? "border-[#4FAEB2] bg-[#4FAEB2]/[0.10] text-[#3F8E91]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                  {metodo === "efectivo" && (
                    <p className="mt-1 text-[11px] text-slate-400">En efectivo se registra el movimiento en la caja abierta. Sin caja abierta no se puede confirmar.</p>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-600">Motivo</label>
                <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                  placeholder="Ej: producto fallado, el cliente se arrepintió…"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30" />
              </div>
            </div>
          ) : (
            /* ── PASO 3 ── */
            <div className="space-y-4 text-sm">
              <div className="rounded-xl border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">Resumen</div>
                <dl className="divide-y divide-slate-100">
                  <Fila k="Venta original" v={`${venta.numero_control}${venta.cliente_nombre ? ` · ${venta.cliente_nombre}` : ""}`} />
                  <Fila k="Tipo" v={seleccion.every((l) => (cant[l.venta_item_id] ?? 0) >= l.cantidad_disponible) && seleccion.length === lineas.filter((l) => l.cantidad_disponible > 0).length ? "Devolución total" : "Devolución parcial"} />
                  <Fila k="Resolución" v={resolucion === "cambio" ? "Cambio por otro producto" : "Reembolso de dinero"} />
                  <div className="px-4 py-2">
                    <dt className="text-xs font-semibold text-slate-500">Productos devueltos</dt>
                    <dd className="mt-1 space-y-0.5">
                      {seleccion.map((l) => (
                        <p key={l.venta_item_id} className="text-slate-700">
                          {cant[l.venta_item_id]}× {l.producto_nombre} — {gs(l.precio_unitario * (cant[l.venta_item_id] ?? 0))}
                          <span className={`ml-1 text-xs ${(cond[l.venta_item_id] ?? "buen_estado") === "danado" ? "text-red-600" : "text-emerald-700"}`}>
                            ({(cond[l.venta_item_id] ?? "buen_estado") === "danado" ? "dañado, no vuelve al stock" : "vuelve al stock"})
                          </span>
                        </p>
                      ))}
                    </dd>
                  </div>
                  {esSaldo ? (
                    <>
                      <Fila k="Saldo a favor generado" v={gs(totalDevuelto)} />
                      <Fila k="Se acredita a" v={clienteCredito?.nombre ?? "—"} />
                      <Fila k="Caja afectada" v="Queda registrado en la caja abierta (no afecta el efectivo)" />
                    </>
                  ) : (
                    <>
                      <Fila k="Reembolso" v={`${gs(totalDevuelto)} · ${metodo}`} />
                      <Fila k="Caja afectada" v={metodo === "efectivo" ? "Caja abierta (egreso en efectivo)" : `Caja abierta (${metodo}, no afecta el efectivo)`} />
                    </>
                  )}
                  <Fila k="Motivo" v={motivo.trim() || "—"} />
                </dl>
              </div>
              <p className="text-xs text-slate-400">Al confirmar se registra el movimiento de inventario y, si corresponde, el de caja. La venta original no se modifica ni se elimina.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-6 py-4">
          <button onClick={paso === 1 ? onClose : () => setPaso((p) => (p === 3 ? 2 : 1))}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            {paso === 1 ? "Cancelar" : "Atrás"}
          </button>
          {paso < 3 ? (
            <button onClick={() => setPaso((p) => (p === 1 ? 2 : 3))} disabled={paso === 1 ? !puedePaso2 : !puedeConfirmar}
              className="rounded-lg bg-[#4FAEB2] px-5 py-2 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50">
              Continuar
            </button>
          ) : (
            <button onClick={() => void confirmar()} disabled={guardando || !puedeConfirmar}
              className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] px-5 py-2 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50">
              {guardando ? <><Loader2 className="h-4 w-4 animate-spin" /> Confirmando…</> : <><Check className="h-4 w-4" /> Confirmar devolución</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2">
      <dt className="text-xs font-semibold text-slate-500">{k}</dt>
      <dd className="text-right text-slate-700">{v}</dd>
    </div>
  );
}
