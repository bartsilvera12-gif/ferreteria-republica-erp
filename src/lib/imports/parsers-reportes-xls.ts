/**
 * Parsers para los reportes del sistema del cliente (export .xls binario).
 *
 * Estos reportes NO son tablas limpias:
 *  - Tienen títulos y se PAGINAN: repiten "Empresa/Usuario/Producto" cada página.
 *  - El identificador viene mezclado en una sola celda "Producto":
 *        "<código interno> - <código fábrica> <descripción>"
 *    …pero el código de fábrica NO siempre existe (a veces la celda es
 *        "<código interno> - <descripción>" y arranca con una palabra).
 *  - Las columnas están dispersas con columnas fantasma de por medio.
 *
 * Por eso se detecta la fila de encabezado por sus etiquetas y se lee por
 * posición. El código interno (número antes de " - ") es la llave de cruce:
 * está siempre y es única.
 */
import { parseNumero, parseIva, parseUnidad, type FilaNormalizada, type Fuente } from "./consolidacion-productos";

/** Normaliza un texto de encabezado: sin acentos, solo A-Z0-9. */
function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Separa la celda "Producto" en código interno / código de fábrica / descripción.
 * El código de fábrica es el primer token tras " - " SOLO si contiene algún
 * dígito y deja descripción detrás; si es una palabra (ADHESIVO, SOPORTE), no
 * hay código de fábrica y todo el resto es la descripción.
 */
export function parseProductoCell(raw: unknown): { interno: string; fabrica: string; descripcion: string } {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d+)\s*-\s*(.*)$/);
  if (!m) return { interno: "", fabrica: "", descripcion: s };
  const interno = m[1];
  const rest = m[2].trim();
  const sp = rest.indexOf(" ");
  const first = sp === -1 ? rest : rest.slice(0, sp);
  const remainder = sp === -1 ? "" : rest.slice(sp + 1).trim();
  if (/\d/.test(first) && remainder) {
    return { interno, fabrica: first, descripcion: remainder };
  }
  return { interno, fabrica: "", descripcion: rest };
}

/** Es una fila de datos si la celda Producto empieza con "<número> - ". */
function esFilaDato(celdaProducto: unknown): boolean {
  return /^\s*\d+\s*-\s*/.test(String(celdaProducto ?? ""));
}

type Matcher = (label: string) => boolean;
const eq = (v: string): Matcher => (l) => l === v;
const starts = (v: string): Matcher => (l) => l.startsWith(v);
const anyOf = (...ms: Matcher[]): Matcher => (l) => ms.some((m) => m(l));

/** Construye label→columna mirando la fila de encabezado y la siguiente. */
function mapaEtiquetas(aoa: unknown[][], headerRow: number): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const fila of [aoa[headerRow], aoa[headerRow + 1]]) {
    if (!fila) continue;
    fila.forEach((cell, col) => {
      const k = norm(cell);
      if (k && !mapa.has(k)) mapa.set(k, col);
    });
  }
  return mapa;
}

function buscarCol(mapa: Map<string, number>, matcher: Matcher): number {
  for (const [label, col] of mapa) if (matcher(label)) return col;
  return -1;
}

/** Ubica la fila de encabezado (la primera cuyo alguna celda es "PRODUCTO"). */
function findHeaderRow(aoa: unknown[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 25); i++) {
    const fila = aoa[i];
    if (fila && fila.some((c) => norm(c) === "PRODUCTO")) return i;
  }
  return -1;
}

/**
 * Ubica la columna REAL donde vienen los datos "Producto" (`<n> - ...`).
 * No se puede confiar en la posición del encabezado: en Stock General la
 * etiqueta "Producto" está en otra columna que los valores. Se elige la
 * columna que más veces matchea el patrón en las primeras filas de datos.
 */
function findProductoDataCol(aoa: unknown[][], desde: number): number {
  const conteo = new Map<number, number>();
  let vistas = 0;
  for (let i = desde; i < aoa.length && vistas < 60; i++) {
    const fila = aoa[i];
    if (!fila) continue;
    let filaTieneAlgo = false;
    fila.forEach((cell, col) => {
      if (/^\s*\d+\s*-\s*\S/.test(String(cell ?? ""))) {
        conteo.set(col, (conteo.get(col) ?? 0) + 1);
        filaTieneAlgo = true;
      }
    });
    if (filaTieneAlgo) vistas++;
  }
  let mejor = -1, max = 0;
  for (const [col, n] of conteo) if (n > max) { max = n; mejor = col; }
  return mejor;
}

export interface DiagnosticoParser {
  fuente: Fuente;
  filas_datos: number;
  filas_ignoradas: number;
  con_codigo_fabrica: number;
  columnas: Record<string, number>;
  columnas_faltantes: string[];
}

/** Definición de columnas esperadas por reporte. */
const COLUMNAS: Record<Fuente, Record<string, Matcher>> = {
  productos: {
    producto: eq("PRODUCTO"),
    stock: anyOf(eq("EXISTENCIA"), eq("CANTIDAD")),
    costo: (l) => (l === "COSTO" || l === "COSTOUNITARIO") && !l.includes("TOTAL"),
    mayorista: eq("MAYORISTA"),
    precio_venta: eq("PRECIOVENTA"),
    unidad: starts("UNIDAD"),
  },
  stock_general: {
    producto: eq("PRODUCTO"),
    categoria: anyOf(eq("FAMILIA"), eq("CATEGORIA")),
    codigo_barras: starts("CODIGOBARRA"),
    stock: anyOf(eq("CANTIDAD"), eq("EXISTENCIA")),
  },
  stock_valorizado: {
    producto: eq("PRODUCTO"),
    codigo_barras: starts("CODIGOBARRA"),
    iva: eq("IVA"),
    stock: anyOf(eq("EXISTENCIA"), eq("CANTIDAD")),
    costo: (l) => l === "COSTOUNITARIO" || l === "COSTO",
    precio_venta: eq("PRECIOVENTA"),
  },
};

/** Campos sin los cuales no tiene sentido el reporte (para avisar). */
const REQUERIDOS: Record<Fuente, string[]> = {
  productos: ["producto", "stock", "costo", "precio_venta"],
  stock_general: ["producto", "categoria", "codigo_barras"],
  stock_valorizado: ["producto", "codigo_barras", "iva", "stock", "costo", "precio_venta"],
};

/**
 * Convierte el AOA (array de arrays) de un reporte en filas normalizadas listas
 * para `consolidar()`. Devuelve también un diagnóstico para mostrar en la UI.
 */
export function parseReporte(
  fuente: Fuente,
  aoa: unknown[][]
): { filas: FilaNormalizada[]; diag: DiagnosticoParser } {
  const headerRow = findHeaderRow(aoa);
  const mapa = headerRow >= 0 ? mapaEtiquetas(aoa, headerRow) : new Map<string, number>();

  const cols: Record<string, number> = {};
  for (const [logical, matcher] of Object.entries(COLUMNAS[fuente])) {
    cols[logical] = buscarCol(mapa, matcher);
  }
  const desde = headerRow >= 0 ? headerRow + 1 : 0;
  // La celda de datos "Producto" puede estar en otra columna que su encabezado.
  const prodCol = findProductoDataCol(aoa, desde);
  cols.producto = prodCol >= 0 ? prodCol : cols.producto;

  const faltantes = REQUERIDOS[fuente].filter((c) => (cols[c] ?? -1) < 0);

  const get = (fila: unknown[], logical: string): string => {
    const c = cols[logical];
    return c >= 0 ? String(fila[c] ?? "").trim() : "";
  };

  const filas: FilaNormalizada[] = [];
  let ignoradas = 0;
  let conFabrica = 0;

  for (let i = desde; i < aoa.length; i++) {
    const fila = aoa[i];
    if (!fila) continue;
    const celdaProducto = cols.producto >= 0 ? fila[cols.producto] : fila[1];
    if (!esFilaDato(celdaProducto)) { ignoradas++; continue; }

    const { interno, fabrica, descripcion } = parseProductoCell(celdaProducto);
    if (fabrica) conFabrica++;

    filas.push({
      fuente,
      fila: i + 1,
      codigo_interno: interno,
      codigo_fabrica: fabrica,
      codigo_barras: fuente === "productos" ? "" : norm(get(fila, "codigo_barras")),
      descripcion: descripcion.toUpperCase(),
      categoria: get(fila, "categoria").toUpperCase(),
      unidad: parseUnidad(get(fila, "unidad")),
      stock: parseNumero(get(fila, "stock")),
      costo: parseNumero(get(fila, "costo")),
      // "INHABILITADO" y encabezados repetidos → parseNumero devuelve null.
      costo_mayorista: parseNumero(get(fila, "mayorista")),
      precio_venta: parseNumero(get(fila, "precio_venta")),
      iva: parseIva(get(fila, "iva")),
    });
  }

  return {
    filas,
    diag: {
      fuente,
      filas_datos: filas.length,
      filas_ignoradas: ignoradas,
      con_codigo_fabrica: conFabrica,
      columnas: cols,
      columnas_faltantes: faltantes,
    },
  };
}
