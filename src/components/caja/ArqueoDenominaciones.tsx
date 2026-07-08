"use client";

/**
 * ArqueoDenominaciones — planilla de conteo físico de efectivo por
 * denominación (monedas y billetes). Reutilizable en apertura y cierre de caja.
 *
 * - Solo la columna "Cantidad" es editable; "Valor" = denominación × cantidad
 *   se calcula automáticamente (solo lectura).
 * - Cantidad 0 permitida; negativas NO (se clampean a 0).
 * - Muestra el total contado en tiempo real.
 * - Las denominaciones base viven en @/lib/caja/denominaciones (no acá).
 */

import { DENOMINACIONES, type ArqueoItem, type TipoDenominacion } from "@/lib/caja/denominaciones";

function fmtGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}

/** Estado del arqueo como mapa denominación → cantidad (lo que maneja el padre). */
export type ArqueoCantidades = Record<number, number>;

/** Convierte el mapa de cantidades al detalle ArqueoItem[] para enviar al backend. */
export function cantidadesAArqueo(cant: ArqueoCantidades): ArqueoItem[] {
  return DENOMINACIONES.map((d) => {
    const cantidad = Math.max(0, Math.floor(cant[d.valor] || 0));
    return { tipo: d.tipo, denominacion: d.valor, cantidad, valor: d.valor * cantidad };
  });
}

/** Total contado desde el mapa de cantidades. */
export function totalArqueo(cant: ArqueoCantidades): number {
  return cantidadesAArqueo(cant).reduce((s, it) => s + it.valor, 0);
}

/** Mapa vacío inicial (todas las denominaciones en 0). */
export function arqueoVacio(): ArqueoCantidades {
  const m: ArqueoCantidades = {};
  for (const d of DENOMINACIONES) m[d.valor] = 0;
  return m;
}

export default function ArqueoDenominaciones({
  value,
  onChange,
  disabled,
}: {
  value: ArqueoCantidades;
  onChange: (next: ArqueoCantidades) => void;
  disabled?: boolean;
}) {
  const total = totalArqueo(value);

  function setCantidad(denominacion: number, raw: string) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    onChange({ ...value, [denominacion]: n });
  }

  const secciones: { tipo: TipoDenominacion; titulo: string }[] = [
    { tipo: "moneda", titulo: "Monedas" },
    { tipo: "billete", titulo: "Billetes" },
  ];

  return (
    <div className="rounded-xl border-2 border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-[10.5px] uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2 text-left font-bold">Denominación</th>
            <th className="px-3 py-2 text-center font-bold">Cantidad</th>
            <th className="px-3 py-2 text-right font-bold">Valor</th>
          </tr>
        </thead>
        <tbody>
          {secciones.map((sec) => (
            <SeccionArqueo
              key={sec.tipo}
              titulo={sec.titulo}
              tipo={sec.tipo}
              value={value}
              onSet={setCantidad}
              disabled={disabled}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
            <td className="px-3 py-2.5 text-sm font-bold text-[#3F8E91]" colSpan={2}>
              Total contado
            </td>
            <td className="px-3 py-2.5 text-right text-base font-bold tabular-nums text-[#3F8E91]">
              {fmtGs(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SeccionArqueo({
  titulo,
  tipo,
  value,
  onSet,
  disabled,
}: {
  titulo: string;
  tipo: TipoDenominacion;
  value: ArqueoCantidades;
  onSet: (denominacion: number, raw: string) => void;
  disabled?: boolean;
}) {
  const filas = DENOMINACIONES.filter((d) => d.tipo === tipo);
  return (
    <>
      <tr className="bg-slate-100/70">
        <td colSpan={3} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
          {titulo}
        </td>
      </tr>
      {filas.map((d) => {
        const cantidad = Math.max(0, Math.floor(value[d.valor] || 0));
        return (
          <tr key={d.valor} className="border-t border-slate-100">
            <td className="px-3 py-2 font-medium tabular-nums text-slate-700">{fmtGs(d.valor)}</td>
            <td className="px-3 py-2 text-center">
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                disabled={disabled}
                value={cantidad === 0 ? "" : cantidad}
                placeholder="0"
                onChange={(e) => onSet(d.valor, e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-24 rounded-lg border-2 border-slate-200 px-2 py-1.5 text-center text-sm font-semibold tabular-nums outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 disabled:bg-slate-50 disabled:text-slate-400"
              />
            </td>
            <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">
              {fmtGs(d.valor * cantidad)}
            </td>
          </tr>
        );
      })}
    </>
  );
}
