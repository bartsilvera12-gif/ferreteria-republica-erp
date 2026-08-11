"use client";

/**
 * /reportes/stock-minimo — productos por debajo del stock mínimo.
 * Un producto entra si stock_actual < stock_minimo (mínimo definido > 0).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { PackageMinus, Loader2, RefreshCw } from "lucide-react";

interface Row {
  id: string;
  nombre: string;
  sku: string | null;
  codigo_barras: string | null;
  marca: string | null;
  unidad_medida: string;
  stock_actual: number;
  stock_minimo: number;
  faltante: number;
  categoria_nombre: string | null;
  proveedor_nombre: string | null;
}

function num(v: number) {
  return v.toLocaleString("es-PY");
}

export default function ReporteStockMinimoPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch("/api/reportes/stock-minimo", { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (j?.success) setItems(j.data.items as Row[]);
      else setError(j?.error ?? "No se pudo cargar el reporte.");
    } catch {
      setError("Error de red al cargar el reporte.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const q = busqueda.trim().toLowerCase();
  const filtrados = q === "" ? items : items.filter((i) =>
    [i.nombre, i.sku, i.codigo_barras, i.marca, i.categoria_nombre, i.proveedor_nombre]
      .some((v) => (v ?? "").toLowerCase().includes(q))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Productos con stock mínimo"
        description="Productos cuyo stock actual quedó por debajo del mínimo definido. Ordenados por mayor faltante."
        backHref="/reportes"
        backLabel="Reportes"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, SKU, marca, categoría o proveedor…"
          className="h-11 w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
        />
        <button
          type="button"
          onClick={cargar}
          className="inline-flex items-center gap-2 rounded-xl border border-[#4FAEB2]/30 bg-white px-4 py-2.5 text-sm font-bold text-[#3F8E91] hover:bg-[#4FAEB2]/10"
        >
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-3.5">
          <PackageMinus className="h-4 w-4 text-[#4FAEB2]" />
          <h2 className="text-[15px] font-bold text-slate-800">Bajo stock mínimo</h2>
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-[#4FAEB2]" />}
          {!cargando && <span className="text-xs text-slate-400">{filtrados.length} producto{filtrados.length === 1 ? "" : "s"}</span>}
        </div>

        {error ? (
          <p className="px-5 py-10 text-center text-sm text-red-600">{error}</p>
        ) : cargando ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">
            {items.length === 0 ? "No hay productos por debajo del stock mínimo. 🎉" : "Ningún producto coincide con la búsqueda."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-semibold">Producto</th>
                  <th className="px-3 py-3 font-semibold">Categoría</th>
                  <th className="px-3 py-3 font-semibold">Proveedor</th>
                  <th className="px-3 py-3 text-right font-semibold">Stock actual</th>
                  <th className="px-3 py-3 text-right font-semibold">Mínimo</th>
                  <th className="px-4 py-3 text-right font-semibold">Faltante</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtrados.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-[#4FAEB2]/[0.03]">
                    <td className="px-5 py-2.5">
                      <Link href={`/inventario/${r.id}/editar`} className="font-medium text-slate-800 hover:text-[#3F8E91]">
                        {r.nombre}
                      </Link>
                      <div className="text-[11px] text-slate-400">
                        {r.sku ? <span className="font-mono">{r.sku}</span> : null}
                        {r.marca ? <span> · {r.marca}</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{r.categoria_nombre || "—"}</td>
                    <td className="px-3 py-2.5 text-slate-600">{r.proveedor_nombre || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-600 font-semibold">{num(r.stock_actual)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{num(r.stock_minimo)}</td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-amber-700">
                      {num(r.faltante)} <span className="text-[10px] font-normal text-slate-400">{r.unidad_medida}</span>
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
