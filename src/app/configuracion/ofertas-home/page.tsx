"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  Calendar,
  Plus,
  X,
  Search,
  Loader2,
  Save,
  Sparkles,
  Tag,
  Package,
  AlertCircle,
  Check,
} from "lucide-react";

interface ProductoLite {
  id: string;
  nombre: string;
  sku: string;
  precio_venta: number;
  discount_type?: "percentage" | "fixed" | null;
  discount_value?: number | null;
  discount_starts_at?: string | null;
  discount_ends_at?: string | null;
}

function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtGs(n: number): string {
  return "Gs. " + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function getDiscountInfo(p: ProductoLite): {
  label: string;
  finalPrice: number;
} | null {
  if (!p.discount_type || !p.discount_value || p.discount_value <= 0) return null;
  const base = Number(p.precio_venta) || 0;
  let final = base;
  let label = "";
  if (p.discount_type === "percentage") {
    final = base - (base * Number(p.discount_value)) / 100;
    label = `-${Number(p.discount_value)}%`;
  } else {
    final = base - Number(p.discount_value);
    label = `-${fmtGs(Number(p.discount_value))}`;
  }
  return { label, finalPrice: Math.max(0, Math.round(final)) };
}

export default function OfertasHomePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [countdownEnd, setCountdownEnd] = useState("");
  const [selected, setSelected] = useState<ProductoLite[]>([]);

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<ProductoLite[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Cargar estado inicial
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/configuracion/ofertas-home");
        const json = await res.json();
        if (cancel) return;
        if (!res.ok || !json?.success) throw new Error(json?.error || "Error al cargar");
        setCountdownEnd(isoToDatetimeLocal(json.countdownEnd));
        setSelected(Array.isArray(json.productos) ? json.productos : []);
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  // Buscar productos en el picker (debounce 300ms) — solo con descuento.
  useEffect(() => {
    if (!pickerOpen) return;
    const q = pickerQuery.trim();
    if (q.length < 2) {
      setPickerResults([]);
      return;
    }
    setPickerLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetchWithSupabaseSession(
          `/api/productos/search?q=${encodeURIComponent(q)}&limit=20&con_descuento=1`
        );
        const json = await res.json();
        const items = Array.isArray(json?.data?.items) ? json.data.items : [];
        const rows: ProductoLite[] = items.map(
          (r: {
            id: string;
            nombre: string;
            sku: string;
            precio_venta: number;
            discount_type?: "percentage" | "fixed" | null;
            discount_value?: number | null;
            discount_starts_at?: string | null;
            discount_ends_at?: string | null;
          }) => ({
            id: r.id,
            nombre: r.nombre,
            sku: r.sku,
            precio_venta: Number(r.precio_venta) || 0,
            discount_type: r.discount_type ?? null,
            discount_value: r.discount_value ?? null,
            discount_starts_at: r.discount_starts_at ?? null,
            discount_ends_at: r.discount_ends_at ?? null,
          })
        );
        setPickerResults(rows);
      } catch {
        setPickerResults([]);
      } finally {
        setPickerLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [pickerQuery, pickerOpen]);

  function addProducto(p: ProductoLite) {
    if (selected.some((s) => s.id === p.id)) return;
    if (selected.length >= 3) {
      setError("Máximo 3 productos.");
      return;
    }
    setSelected([...selected, p]);
    setPickerQuery("");
    setPickerOpen(false);
    setError(null);
  }
  function removeProducto(id: string) {
    setSelected(selected.filter((s) => s.id !== id));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const body = {
        countdownEnd: countdownEnd ? new Date(countdownEnd).toISOString() : null,
        productosIds: selected.map((s) => s.id),
      };
      const res = await fetchWithSupabaseSession("/api/configuracion/ofertas-home", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Error al guardar");
      setOkMsg("Cambios guardados correctamente");
      setTimeout(() => setOkMsg(null), 2800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-7 w-7 animate-spin text-[#4FAEB2]" />
      </div>
    );
  }

  return (
    <div className="w-full py-8 px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-[#4FAEB2]/8 border border-[#4FAEB2]/30 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#3F8E91] mb-4">
          <Sparkles className="h-3 w-3 text-[#4FAEB2]" />
          Sitio público · Home
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 tracking-tight leading-tight">
          Ofertas de la semana
        </h1>
        <p className="text-[15px] text-slate-500 mt-2 leading-relaxed max-w-3xl">
          Configurá el banner{" "}
          <span className="font-semibold text-slate-700">
            &quot;Descuentos por tiempo limitado&quot;
          </span>{" "}
          del sitio público. Elegí hasta 3 productos con descuento activo y la fecha en
          que termina la promoción.
        </p>
      </header>

      {/* Alertas */}
      {error && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-800 shadow-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {okMsg && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm font-medium text-emerald-800 shadow-sm">
          <div className="h-5 w-5 rounded-full bg-emerald-600 flex items-center justify-center shrink-0">
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          </div>
          {okMsg}
        </div>
      )}

      {/* Grid responsive: 1 col en mobile/tablet, 2 cols en desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
        {/* Card: Countdown — ocupa 2/5 en desktop */}
        <section className="lg:col-span-2 bg-white rounded-2xl border-2 border-[#4FAEB2]/20 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden hover:border-[#4FAEB2]/40 transition-colors">
          <div className="px-6 py-5 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#4FAEB2] flex items-center justify-center shadow-sm shadow-[#4FAEB2]/30">
              <Calendar className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-800 leading-none">
                Fin del countdown
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Cuándo expira la promoción
              </p>
            </div>
          </div>
          <div className="px-6 py-6">
            <div className="space-y-3">
              <input
                type="datetime-local"
                value={countdownEnd}
                onChange={(e) => setCountdownEnd(e.target.value)}
                className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-[#4FAEB2]/20 focus:border-[#4FAEB2] transition-all outline-none"
              />
              {countdownEnd && (
                <button
                  type="button"
                  onClick={() => setCountdownEnd("")}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Quitar countdown
                </button>
              )}
            </div>
            <p className="mt-4 text-xs text-slate-500 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
              Si lo dejás vacío, el contador no se muestra en el banner. Si lo configurás
              en el pasado, también queda oculto.
            </p>
          </div>
        </section>

        {/* Card: Productos destacados — ocupa 3/5 en desktop */}
        <section className="lg:col-span-3 bg-white rounded-2xl border-2 border-[#4FAEB2]/20 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden hover:border-[#4FAEB2]/40 transition-colors">
          <div className="px-6 py-5 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#4FAEB2] flex items-center justify-center shadow-sm shadow-[#4FAEB2]/30">
                <Package className="h-4.5 w-4.5 text-white" />
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-slate-800 leading-none flex items-center gap-2">
                  Productos destacados
                  <span className="inline-flex items-center justify-center min-w-[30px] h-[24px] px-2 rounded-full bg-[#4FAEB2] text-white text-[11px] font-bold tabular-nums">
                    {selected.length}/3
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Solo se listan productos con descuento configurado
                </p>
              </div>
            </div>
            {selected.length < 3 && (
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(true);
                  setPickerQuery("");
                  setPickerResults([]);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-xs font-bold px-3.5 py-2 transition-colors shadow-sm shadow-[#4FAEB2]/30"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                Agregar producto
              </button>
            )}
          </div>

          <div className="px-6 py-5">
            {selected.length === 0 ? (
              <div className="py-12 text-center">
                <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[#4FAEB2]/8 border border-[#4FAEB2]/20 mb-3">
                  <Package className="h-6 w-6 text-[#4FAEB2]" />
                </div>
                <p className="text-sm font-semibold text-slate-700">
                  Sin productos seleccionados
                </p>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                  El banner del home se oculta hasta que agregues al menos uno.
                </p>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {selected.map((p, idx) => {
                  const disc = getDiscountInfo(p);
                  return (
                    <li
                      key={p.id}
                      className="group flex items-center gap-4 rounded-xl border-2 border-slate-100 bg-white p-3.5 hover:border-[#4FAEB2]/40 hover:bg-[#4FAEB2]/3 transition-all"
                    >
                      <div className="flex-none h-10 w-10 rounded-xl bg-[#4FAEB2] text-white font-bold text-base flex items-center justify-center shadow-sm shadow-[#4FAEB2]/30 tabular-nums">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate leading-tight">
                          {p.nombre}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-[11px] font-mono text-slate-500">
                            {p.sku}
                          </span>
                          <span className="text-slate-300">·</span>
                          {disc ? (
                            <>
                              <span className="text-[11px] text-slate-400 line-through tabular-nums">
                                {fmtGs(p.precio_venta)}
                              </span>
                              <span className="text-[12px] font-bold text-[#3F8E91] tabular-nums">
                                {fmtGs(disc.finalPrice)}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-md bg-[#4FAEB2]/10 text-[#3F8E91] px-1.5 py-0.5 text-[10px] font-bold border border-[#4FAEB2]/20">
                                <Tag className="h-2.5 w-2.5" strokeWidth={2.8} />
                                {disc.label}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-[11px] font-medium text-slate-600 tabular-nums">
                                {fmtGs(p.precio_venta)}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold">
                                <AlertCircle className="h-2.5 w-2.5" strokeWidth={2.8} />
                                Sin descuento
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeProducto(p.id)}
                        className="flex-none h-9 w-9 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors"
                        title="Quitar producto"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {selected.length > 0 && (
              <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-[#4FAEB2]/25 bg-[#4FAEB2]/5 px-3.5 py-3">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-[#3F8E91]" />
                <p className="text-[11.5px] text-slate-700 leading-relaxed">
                  Cada producto que agregás ya tiene un{" "}
                  <span className="font-semibold text-[#3F8E91]">
                    descuento promocional
                  </span>{" "}
                  configurado en su edición. Lo verás reflejado con el precio tachado en
                  el home del sitio público.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Save bar */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] hover:bg-[#3F8E91] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-6 py-3 text-sm transition-all shadow-md shadow-[#4FAEB2]/30 hover:shadow-lg hover:shadow-[#4FAEB2]/40"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>

      {/* Picker modal */}
      {pickerOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden border-2 border-[#4FAEB2]/30"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-9 w-9 rounded-xl bg-[#4FAEB2] flex items-center justify-center shrink-0 shadow-sm shadow-[#4FAEB2]/30">
                  <Tag className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-800 leading-none">
                    Productos con descuento
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Solo se listan los que tienen oferta configurada
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="h-9 w-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Buscar por nombre o SKU..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border-2 border-slate-200 bg-white text-sm focus:ring-2 focus:ring-[#4FAEB2]/20 focus:border-[#4FAEB2] outline-none transition-all"
                />
              </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-2 py-2 min-h-[220px]">
              {pickerLoading && (
                <div className="py-12 text-center">
                  <Loader2 className="h-5 w-5 animate-spin text-[#4FAEB2] mx-auto" />
                  <p className="text-xs text-slate-400 mt-2">Buscando...</p>
                </div>
              )}
              {!pickerLoading && pickerQuery.trim().length < 2 && (
                <div className="py-12 text-center">
                  <Search className="h-7 w-7 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-600">
                    Escribí al menos 2 caracteres
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Solo aparecen productos con descuento activo
                  </p>
                </div>
              )}
              {!pickerLoading &&
                pickerQuery.trim().length >= 2 &&
                pickerResults.length === 0 && (
                  <div className="py-12 text-center">
                    <Tag className="h-7 w-7 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-600">
                      Sin resultados
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Ningún producto con descuento coincide con &quot;{pickerQuery}&quot;
                    </p>
                  </div>
                )}
              {!pickerLoading &&
                pickerResults.map((p) => {
                  const disc = getDiscountInfo(p);
                  const yaSel = selected.some((s) => s.id === p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProducto(p)}
                      disabled={yaSel}
                      className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#4FAEB2]/8 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {p.nombre}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[11px] font-mono text-slate-500">
                            {p.sku}
                          </span>
                          {disc && (
                            <>
                              <span className="text-slate-300">·</span>
                              <span className="text-[11px] text-slate-400 line-through tabular-nums">
                                {fmtGs(p.precio_venta)}
                              </span>
                              <span className="text-[11px] font-bold text-[#3F8E91] tabular-nums">
                                {fmtGs(disc.finalPrice)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {disc && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-[#4FAEB2] text-white px-2 py-1 text-[10.5px] font-bold shrink-0 shadow-sm shadow-[#4FAEB2]/30">
                          <Tag className="h-2.5 w-2.5" strokeWidth={2.8} />
                          {disc.label}
                        </span>
                      )}
                      {yaSel && (
                        <span className="text-[10.5px] font-bold text-slate-400 shrink-0">
                          AGREGADO
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-sm font-semibold text-slate-600 hover:text-[#3F8E91] transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
