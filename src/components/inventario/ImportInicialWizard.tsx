"use client";

/**
 * Wizard de importación inicial del catálogo.
 * Paso 1: cargar los 3 reportes → Paso 2: revisar el consolidado (conflictos,
 * faltantes, duplicados evitados) → Paso 3: confirmar e importar.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Fuente = "productos" | "stock_general" | "stock_valorizado";

const FUENTES: { fuente: Fuente; campo: string; titulo: string; aporta: string }[] = [
  { fuente: "productos", campo: "file_productos", titulo: "1 · Productos",
    aporta: "Código interno y de fábrica, descripción, stock, costo, costo mayorista, precio de venta y unidad de medida." },
  { fuente: "stock_general", campo: "file_stock_general", titulo: "2 · Stock General",
    aporta: "Código de fábrica, descripción, categoría/familia, código de barras y stock." },
  { fuente: "stock_valorizado", campo: "file_stock_valorizado", titulo: "3 · Stock Valorizado",
    aporta: "Código interno y de fábrica, descripción, código de barras, IVA, stock, costo unitario y precio de venta." },
];

const FUENTE_LABEL: Record<Fuente, string> = {
  productos: "Productos",
  stock_general: "Stock General",
  stock_valorizado: "Stock Valorizado",
};

const CAMPO_LABEL: Record<string, string> = {
  producto: "Producto", codigo_interno: "Código interno", codigo_fabrica: "Código de fábrica",
  codigo_barras: "Código de barras", descripcion: "Descripción",
  categoria: "Categoría", unidad: "Unidad de medida", stock: "Stock",
  costo: "Precio de costo", mayorista: "Costo mayorista", costo_mayorista: "Costo mayorista",
  precio_venta: "Precio de venta", iva: "IVA",
};

interface Conflicto { campo: string; elegido: string; valores: { fuente: Fuente; valor: string }[] }
interface Item {
  clave: string; matched_por: string[]; fuentes: Fuente[];
  codigo_interno: string; codigo_fabrica: string; codigo_barras: string;
  descripcion: string; categoria: string; unidad: string;
  stock: number | null; costo: number | null; costo_mayorista: number | null;
  precio_venta: number | null; iva: string;
  conflictos: Conflicto[]; faltantes: string[]; errores: string[];
  match_existente_id?: string | null;
}
interface Archivo {
  fuente: Fuente; filename: string;
  filas_datos: number; filas_ignoradas: number; con_codigo_fabrica: number;
  columnas: Record<string, number>; columnas_faltantes: string[];
}
interface Preview {
  items: Item[];
  archivos: Archivo[];
  resumen: {
    total: number; con_conflictos: number; con_faltantes: number; con_errores: number;
    nuevos: number; existentes: number;
    por_fuente: Record<Fuente, number>;
    por_criterio: Record<string, number>;
  };
}

const num = (n: number | null) =>
  n === null || n === undefined ? "—" : new Intl.NumberFormat("es-PY").format(n);

type Filtro = "todos" | "conflictos" | "faltantes" | "errores" | "nuevos" | "existentes";

export default function ImportInicialWizard() {
  const router = useRouter();
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cargando, setCargando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Record<string, unknown> | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [actualizarExistentes, setActualizarExistentes] = useState(true);
  const [crearCategorias, setCrearCategorias] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);

  const algunArchivo = Object.values(files).some(Boolean);

  function buildForm(): FormData {
    const fd = new FormData();
    for (const { campo } of FUENTES) {
      const f = files[campo];
      if (f) fd.append(campo, f);
    }
    return fd;
  }

  async function analizar() {
    setCargando(true); setError(null); setResultado(null);
    try {
      const r = await fetch("/api/inventario/productos/import-inicial/preview", {
        method: "POST", body: buildForm(),
      });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? "No se pudo analizar.");
      setPreview((j.data ?? j) as Preview);
      setFiltro("todos");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo analizar.");
    } finally {
      setCargando(false);
    }
  }

  async function importar() {
    setImportando(true); setError(null);
    try {
      const fd = buildForm();
      fd.append("actualizar_existentes", actualizarExistentes ? "1" : "0");
      fd.append("crear_categorias", crearCategorias ? "1" : "0");
      const r = await fetch("/api/inventario/productos/import-inicial/commit", {
        method: "POST", body: fd,
      });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? "No se pudo importar.");
      setResultado((j.data ?? j) as Record<string, unknown>);
      setPreview(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo importar.");
    } finally {
      setImportando(false);
    }
  }

  const items = useMemo(() => {
    if (!preview) return [];
    switch (filtro) {
      case "conflictos": return preview.items.filter((i) => i.conflictos.length > 0);
      case "faltantes": return preview.items.filter((i) => i.faltantes.length > 0);
      case "errores": return preview.items.filter((i) => i.errores.length > 0);
      case "nuevos": return preview.items.filter((i) => !i.match_existente_id);
      case "existentes": return preview.items.filter((i) => !!i.match_existente_id);
      default: return preview.items;
    }
  }, [preview, filtro]);

  // ── Resultado final ───────────────────────────────────────────────────────
  if (resultado) {
    const r = resultado as Record<string, number & string>;
    return (
      <div className="rounded-2xl border-2 border-[#4FAEB2]/25 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Importación completada</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Productos creados", r.creados], ["Actualizados", r.actualizados],
            ["Omitidos", r.omitidos], ["Errores", r.errores],
            ["Categorías creadas", r.categorias_creadas],
            ["Movimientos de stock", r.movimientos_generados],
            ["Unidades iniciales", r.unidades_iniciales],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-xl border border-[#4FAEB2]/20 bg-[#E5F4F4]/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{String(k)}</p>
              <p className="mt-1 text-xl font-bold text-[#3F8E91]">{num(Number(v ?? 0))}</p>
            </div>
          ))}
        </div>
        {Array.isArray(resultado.mensajes_error) && (resultado.mensajes_error as string[]).length > 0 && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs font-semibold text-rose-700">Errores</p>
            <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-rose-700">
              {(resultado.mensajes_error as string[]).map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </div>
        )}
        <div className="mt-5 flex gap-2">
          <a href="/inventario" className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">
            Ir al inventario
          </a>
          <button
            onClick={() => { setResultado(null); setFiles({}); }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Importar de nuevo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* Paso 1 — archivos */}
      <section className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#3F8E91]">Paso 1 · Cargar los reportes</h2>
        <p className="mt-1 text-xs text-slate-500">
          Podés cargar los tres o solo los que tengas. Los datos que falten en un reporte
          se completan con los otros.
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {FUENTES.map(({ campo, titulo, aporta }) => (
            <label
              key={campo}
              className={`cursor-pointer rounded-xl border-2 p-4 transition ${
                files[campo] ? "border-[#4FAEB2] bg-[#E5F4F4]/50" : "border-dashed border-slate-300 hover:border-[#4FAEB2]/60"
              }`}
            >
              <p className="text-sm font-bold text-slate-900">{titulo}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{aporta}</p>
              <input
                type="file" accept=".xlsx,.xls,.csv" className="mt-3 block w-full text-xs"
                onChange={(e) => {
                  setFiles((p) => ({ ...p, [campo]: e.target.files?.[0] ?? null }));
                  setPreview(null);
                }}
              />
              {files[campo] && (
                <p className="mt-2 truncate text-[11px] font-semibold text-[#3F8E91]">{files[campo]!.name}</p>
              )}
            </label>
          ))}
        </div>
        <button
          onClick={analizar}
          disabled={!algunArchivo || cargando}
          className="mt-4 rounded-lg bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-40"
        >
          {cargando ? "Analizando…" : "Analizar y consolidar"}
        </button>
      </section>

      {/* Paso 2 — revisión */}
      {preview && (
        <>
          <section className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#3F8E91]">Paso 2 · Revisar el consolidado</h2>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Productos", preview.resumen.total, "text-[#3F8E91]"],
                ["Nuevos", preview.resumen.nuevos, "text-emerald-600"],
                ["Ya existen", preview.resumen.existentes, "text-sky-600"],
                ["Con diferencias", preview.resumen.con_conflictos, "text-amber-600"],
                ["Con datos faltantes", preview.resumen.con_faltantes, "text-orange-600"],
                ["Con errores", preview.resumen.con_errores, "text-rose-600"],
              ].map(([k, v, c]) => (
                <div key={String(k)} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{String(k)}</p>
                  <p className={`mt-1 text-xl font-bold ${c}`}>{num(Number(v))}</p>
                </div>
              ))}
            </div>

            {/* Diagnóstico por archivo: qué columnas se reconocieron */}
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {preview.archivos.map((a) => (
                <div key={a.fuente} className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-bold text-slate-900">{FUENTE_LABEL[a.fuente]}</p>
                  <p className="truncate text-[11px] text-slate-500">{a.filename}</p>
                  <p className="mt-2 text-[11px] text-slate-600">
                    <span className="font-semibold text-[#3F8E91]">{num(a.filas_datos)}</span> filas de datos
                    {a.filas_ignoradas > 0 && <span className="text-slate-400"> · {num(a.filas_ignoradas)} ignoradas</span>}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-600">
                    Columnas: {Object.entries(a.columnas).filter(([, v]) => v >= 0).map(([c]) => CAMPO_LABEL[c] ?? c).join(", ") || "ninguna"}
                  </p>
                  {a.columnas_faltantes.length > 0 && (
                    <p className="mt-1 text-[11px] text-amber-700">
                      No se encontró: {a.columnas_faltantes.map((c) => CAMPO_LABEL[c] ?? c).join(", ")}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Cómo se cruzaron */}
            <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
              <span className="text-slate-500">Productos cruzados por:</span>
              {Object.entries(preview.resumen.por_criterio).map(([k, v]) => (
                <span key={k} className="rounded-full bg-[#E5F4F4] px-2 py-0.5 font-semibold text-[#3F8E91]">
                  {CAMPO_LABEL[k] ?? k}: {num(Number(v))}
                </span>
              ))}
            </div>
          </section>

          {/* Tabla */}
          <section className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-sm">
            <div className="flex flex-wrap gap-2 border-b border-slate-200 p-4">
              {([
                ["todos", "Todos"], ["conflictos", "Con diferencias"], ["faltantes", "Datos faltantes"],
                ["errores", "Errores"], ["nuevos", "Nuevos"], ["existentes", "Ya existen"],
              ] as [Filtro, string][]).map(([k, label]) => (
                <button
                  key={k} onClick={() => setFiltro(k)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    filtro === k ? "bg-[#4FAEB2] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >{label}</button>
              ))}
              <span className="ml-auto self-center text-xs text-slate-500">
                Mostrando {num(Math.min(items.length, 300))} de {num(items.length)}
              </span>
            </div>

            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#E5F4F4] text-[11px] uppercase tracking-wide text-[#3F8E91]">
                  <tr>
                    <th className="p-2">Descripción</th>
                    <th className="p-2">Cód. interno</th>
                    <th className="p-2">Cód. fábrica</th>
                    <th className="p-2">Cód. barras</th>
                    <th className="p-2">Categoría</th>
                    <th className="p-2">Un.</th>
                    <th className="p-2 text-right">Stock</th>
                    <th className="p-2 text-right">Costo</th>
                    <th className="p-2 text-right">Costo may.</th>
                    <th className="p-2 text-right">Venta</th>
                    <th className="p-2">IVA</th>
                    <th className="p-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 300).map((it, idx) => {
                    const key = `${it.clave}-${idx}`;
                    const abierto = expandido === key;
                    const campoEnConflicto = new Set(it.conflictos.map((c) => c.campo));
                    const cell = (campo: string, valor: string) => (
                      <td className={`p-2 ${campoEnConflicto.has(campo) ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>
                        {valor}
                      </td>
                    );
                    return (
                      <tr
                        key={key}
                        onClick={() => setExpandido(abierto ? null : key)}
                        className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${
                          it.errores.length ? "bg-rose-50/60" : ""
                        }`}
                      >
                        <td className="p-2 max-w-[260px]">
                          <p className="truncate font-semibold text-slate-800">{it.descripcion || "—"}</p>
                          <p className="text-[10px] text-slate-400">
                            {it.fuentes.map((f) => FUENTE_LABEL[f]).join(" · ")}
                          </p>
                          {abierto && (
                            <div className="mt-2 space-y-1 whitespace-normal">
                              {it.conflictos.map((c) => (
                                <p key={c.campo} className="text-[10px] text-amber-800">
                                  <b>{CAMPO_LABEL[c.campo] ?? c.campo}</b>: se usará <b>{c.elegido}</b> —{" "}
                                  {c.valores.map((v) => `${FUENTE_LABEL[v.fuente]}: ${v.valor}`).join(" | ")}
                                </p>
                              ))}
                              {it.faltantes.length > 0 && (
                                <p className="text-[10px] text-orange-700">
                                  Sin dato en ningún reporte: {it.faltantes.map((c) => CAMPO_LABEL[c] ?? c).join(", ")}
                                </p>
                              )}
                              {it.errores.map((e, i) => (
                                <p key={i} className="text-[10px] font-semibold text-rose-700">{e}</p>
                              ))}
                            </div>
                          )}
                        </td>
                        {cell("codigo_interno", it.codigo_interno || "—")}
                        {cell("codigo_fabrica", it.codigo_fabrica || "—")}
                        {cell("codigo_barras", it.codigo_barras || "—")}
                        {cell("categoria", it.categoria || "—")}
                        {cell("unidad", it.unidad || "—")}
                        <td className={`p-2 text-right ${campoEnConflicto.has("stock") ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{num(it.stock)}</td>
                        <td className={`p-2 text-right ${campoEnConflicto.has("costo") ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{num(it.costo)}</td>
                        <td className={`p-2 text-right ${campoEnConflicto.has("costo_mayorista") ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{num(it.costo_mayorista)}</td>
                        <td className={`p-2 text-right ${campoEnConflicto.has("precio_venta") ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{num(it.precio_venta)}</td>
                        {cell("iva", it.iva)}
                        <td className="p-2">
                          {it.errores.length ? (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">Error</span>
                          ) : it.match_existente_id ? (
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700">Ya existe</span>
                          ) : (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">Nuevo</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {items.length === 0 && (
                <p className="p-6 text-center text-xs text-slate-500">Nada que mostrar con este filtro.</p>
              )}
            </div>
          </section>

          {/* Paso 3 — confirmar */}
          <section className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#3F8E91]">Paso 3 · Confirmar</h2>
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={crearCategorias} onChange={(e) => setCrearCategorias(e.target.checked)} />
                Crear las categorías que no existan
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={actualizarExistentes} onChange={(e) => setActualizarExistentes(e.target.checked)} />
                Actualizar los productos que ya existen ({num(preview.resumen.existentes)})
              </label>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Se crearán los productos y se registrará el stock inicial como movimiento de inventario.
              La importación queda guardada en el historial.
            </p>
            <button
              onClick={importar}
              disabled={importando}
              className="mt-4 rounded-lg bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-40"
            >
              {importando ? "Importando…" : `Importar ${num(preview.resumen.total)} productos`}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
