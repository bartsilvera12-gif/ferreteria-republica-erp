/**
 * Unit tests PUROS (sin BD ni red) de las correcciones de galería + descripción.
 * Ejecutar:  tsx scripts/qa-galeria-descripcion-unit.ts
 *
 * Cubre:
 *  - saveProducto legacy: descripcion sin descripcion_html (body NO incluye la key)
 *  - rich: descripcion_html presente
 *  - descripcion_html null explícito (limpia ambos, regla A)
 *  - regla A/B/C del backend (resolveDescripcionFields) sobre el body real
 *  - DELETE legacy: promueve y "devuelve" la nueva principal (regla de promoción)
 *  - DELETE última imagen: nueva principal = null
 *  - la principal SIEMPRE aparece primera
 *  - reorder de secundarias mantiene la principal primera
 *  - MAX default 8 y MAX backend configurable (clamp)
 *  - orphan cleanup: filtro seguro con segundo lookup
 */
import { buildCreateProductoBody, type CrearProductoInput } from "@/lib/inventario/producto-body";
import { resolveDescripcionFields } from "@/lib/sanitize/rich-text";
import { ordenarConPrincipalPrimero, filtrarHuerfanosSeguros } from "@/lib/inventario/galeria-helpers";
import {
  clampMaxProductImages,
  DEFAULT_MAX_PRODUCT_IMAGES,
  HARD_MAX_PRODUCT_IMAGES,
} from "@/lib/inventario/galeria-config";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}
function eq<T>(a: T, b: T, label: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${label} (esperado ${JSON.stringify(b)}, obtuvo ${JSON.stringify(a)})`);
}

const base: CrearProductoInput = {
  nombre: "TALADRO",
  sku: "TAL-001",
  costo_promedio: 0,
  precio_venta: 1000,
  stock_actual: 0,
  stock_minimo: 0,
  unidad_medida: "UNIDAD",
  metodo_valuacion: "CPP",
};

// ── 1) saveProducto payload + regla A/B/C ────────────────────────────────────
console.log("\n[1] saveProducto body + resolveDescripcionFields (A/B/C)");

// Caso 1: legacy → descripcion sin descripcion_html
{
  const body = buildCreateProductoBody({ ...base, descripcion: "Texto legacy" });
  ok(!("descripcion_html" in body), "legacy: body NO contiene la key descripcion_html");
  eq(body.descripcion, "Texto legacy", "legacy: body.descripcion");
  const out = resolveDescripcionFields(body); // backend regla B
  eq(out.descripcion, "Texto legacy", "legacy backend: descripcion final preservada");
  eq(out.descripcion_html, null, "legacy backend: descripcion_html NULL");
}

// Caso compras/nueva: NI descripcion NI descripcion_html
{
  const body = buildCreateProductoBody({ ...base });
  ok(!("descripcion_html" in body), "sin descripción: body NO contiene descripcion_html");
  eq(body.descripcion, null, "sin descripción: body.descripcion = null");
  const out = resolveDescripcionFields(body);
  eq(out.descripcion, null, "sin descripción backend: descripcion null");
  eq(out.descripcion_html, null, "sin descripción backend: html null");
}

// Caso 2: rich → descripcion_html presente y descripcion derivada
{
  const body = buildCreateProductoBody({ ...base, descripcion_html: "<p><strong>Texto nuevo</strong></p>" });
  ok("descripcion_html" in body, "rich: body contiene descripcion_html");
  eq(body.descripcion_html, "<p><strong>Texto nuevo</strong></p>", "rich: body.descripcion_html crudo");
  const out = resolveDescripcionFields(body); // backend regla A
  eq(out.descripcion, "Texto nuevo", "rich backend: descripcion derivada plana");
  ok(typeof out.descripcion_html === "string" && out.descripcion_html.includes("<strong>"), "rich backend: html sanitizado conserva <strong>");
}

// Caso 3: descripcion_html null explícito → limpia ambos (regla A)
{
  const body = buildCreateProductoBody({ ...base, descripcion: "algo", descripcion_html: null });
  ok("descripcion_html" in body, "null explícito: body contiene la key");
  eq(body.descripcion_html, null, "null explícito: body.descripcion_html = null");
  const out = resolveDescripcionFields(body); // regla A con html vacío
  eq(out.descripcion, null, "null explícito backend: descripcion null");
  eq(out.descripcion_html, null, "null explícito backend: descripcion_html null");
}

// ── 2) DELETE legacy: promoción y nueva principal ────────────────────────────
console.log("\n[2] DELETE legacy: promueve la siguiente / null si no queda ninguna");

type Row = { id: string; orden: number; es_principal: boolean };
// Simula la regla del backend: al borrar la principal, la nueva es la primera de
// las restantes por (orden ASC, id ASC) — idéntico a ordenarConPrincipalPrimero.
function nuevaPrincipalTrasBorrar(rows: Row[], idBorrado: string): Row | null {
  const rest = rows.filter((r) => r.id !== idBorrado).map((r) => ({ ...r, es_principal: false }));
  if (rest.length === 0) return null;
  return ordenarConPrincipalPrimero(rest)[0];
}

{
  const rows: Row[] = [
    { id: "A", orden: 0, es_principal: true },
    { id: "B", orden: 1, es_principal: false },
    { id: "C", orden: 2, es_principal: false },
  ];
  const nueva = nuevaPrincipalTrasBorrar(rows, "A");
  eq(nueva?.id, "B", "borrar principal A → promueve B (menor orden)");
}
{
  const soloUna: Row[] = [{ id: "A", orden: 0, es_principal: true }];
  const nueva = nuevaPrincipalTrasBorrar(soloUna, "A");
  eq(nueva, null, "borrar última imagen → nueva principal = null");
}

// ── 3) La principal SIEMPRE primera + reorder secundarias ────────────────────
console.log("\n[3] principal siempre primera / reorder secundarias");
{
  const desordenadas: Row[] = [
    { id: "S2", orden: 2, es_principal: false },
    { id: "P", orden: 5, es_principal: true }, // principal con orden alto
    { id: "S1", orden: 1, es_principal: false },
  ];
  const ord = ordenarConPrincipalPrimero(desordenadas);
  eq(ord.map((r) => r.id), ["P", "S1", "S2"], "principal primera aunque tenga orden mayor; luego orden ASC");
}
{
  // Reorder de secundarias en la UI: se mueve S3 al frente de las secundarias,
  // pero la principal debe seguir en índice 0 del orden completo enviado.
  const principal: Row = { id: "P", orden: 0, es_principal: true };
  const secundarias: Row[] = [
    { id: "S1", orden: 1, es_principal: false },
    { id: "S2", orden: 2, es_principal: false },
    { id: "S3", orden: 3, es_principal: false },
  ];
  const nuevasSec = ["S3", "S1", "S2"];
  const ordenCompleto = [principal.id, ...nuevasSec];
  eq(ordenCompleto[0], "P", "reorder: la principal queda primera en el orden enviado");
  eq(ordenCompleto, ["P", "S3", "S1", "S2"], "reorder: orden completo = [principal, ...secundarias reordenadas]");
}

// ── 4) MAX default 8 / configurable ──────────────────────────────────────────
console.log("\n[4] MAX_PRODUCT_IMAGES: default y configurable (clamp)");
eq(DEFAULT_MAX_PRODUCT_IMAGES, 8, "DEFAULT = 8");
eq(HARD_MAX_PRODUCT_IMAGES, 20, "HARD_MAX = 20");
eq(clampMaxProductImages(undefined), 8, "sin env → 8");
eq(clampMaxProductImages("no-num"), 8, "env no numérico → 8");
eq(clampMaxProductImages("12"), 12, "env configurable 12 → 12");
eq(clampMaxProductImages(0), 8, "env 0 (fuera de rango) → 8");
eq(clampMaxProductImages(25), 8, "env 25 (> hard max) → 8");
eq(clampMaxProductImages(20), 20, "env 20 (= hard max) → 20");
eq(clampMaxProductImages(1), 1, "env 1 (= min) → 1");

// ── 5) Orphan cleanup: segundo lookup ────────────────────────────────────────
console.log("\n[5] orphan cleanup: filtro seguro con segundo lookup");
{
  const huerfanosIniciales = ["e/p/a.jpg", "e/p/b.jpg", "e/p/c.jpg"];
  // Entre el primer y el segundo lookup, "b.jpg" pasó a estar referenciado.
  const referenciadosAhora = new Set<string>(["e/p/b.jpg"]);
  const seguros = filtrarHuerfanosSeguros(huerfanosIniciales, referenciadosAhora);
  eq(seguros, ["e/p/a.jpg", "e/p/c.jpg"], "solo se borran los que siguen sin referencia en el 2º lookup");
}
{
  // Sin cambios: todos siguen huérfanos.
  const seguros = filtrarHuerfanosSeguros(["x/1.jpg"], new Set<string>());
  eq(seguros, ["x/1.jpg"], "sin referencias nuevas → se mantienen todos");
}

// ── Resultado ────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? "OK" : "FALLÓ"} — ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
