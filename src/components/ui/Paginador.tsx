"use client";

/**
 * Barra de paginación de listados (server-side): "Mostrando X–Y de N" +
 * Primera / Anterior / Página A de B / Siguiente / Última.
 * No se muestra si todo entra en una sola página.
 */
export default function Paginador({
  pagina,
  porPagina,
  total,
  onChange,
  cargando = false,
}: {
  pagina: number;
  porPagina: number;
  total: number;
  onChange: (pagina: number) => void;
  cargando?: boolean;
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  if (total <= porPagina) return null;
  const desde = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);
  const btn =
    "inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-gray-500">
        Mostrando {desde.toLocaleString("es-PY")}–{hasta.toLocaleString("es-PY")} de{" "}
        {total.toLocaleString("es-PY")}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => onChange(1)} disabled={cargando || pagina <= 1} className={btn}>
          « Primera
        </button>
        <button
          type="button"
          onClick={() => onChange(Math.max(1, pagina - 1))}
          disabled={cargando || pagina <= 1}
          className={btn}
        >
          ← Anterior
        </button>
        <span className="px-2 text-xs font-medium text-slate-600">
          Página {pagina.toLocaleString("es-PY")} de {totalPaginas.toLocaleString("es-PY")}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(totalPaginas, pagina + 1))}
          disabled={cargando || pagina >= totalPaginas}
          className={btn}
        >
          Siguiente →
        </button>
        <button
          type="button"
          onClick={() => onChange(totalPaginas)}
          disabled={cargando || pagina >= totalPaginas}
          className={btn}
        >
          Última »
        </button>
      </div>
    </div>
  );
}
