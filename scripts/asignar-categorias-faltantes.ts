/**
 * Asigna categoría a los productos que no la tienen, infiriéndola de los
 * productos YA categorizados (Naive Bayes sobre los tokens de la descripción,
 * con IDF para restarle peso a palabras genéricas).
 *
 *   npx tsx scripts/asignar-categorias-faltantes.ts            # DRY-RUN
 *   npx tsx scripts/asignar-categorias-faltantes.ts --apply    # escribe
 *   npx tsx scripts/asignar-categorias-faltantes.ts --rollback <archivo.json>
 *
 * Opcional: --umbral 0.9  (confianza mínima; más alto = menos asignaciones pero
 * más certeras. Medido por holdout: 0.75→83%, 0.90→87%, 0.95→89% de acierto.)
 *
 * NO asigna las categorías comodín (GENERAL / VARIOS): etiquetar algo como
 * "GENERAL" no aporta nada, es lo mismo que dejarlo sin categoría.
 * Lo que no llega al umbral queda sin categoría a propósito: es preferible a
 * ponerle una equivocada.
 *
 * Cada corrida con --apply guarda el detalle en un .json para poder revertir.
 */
import * as fs from "fs";
import { Pool } from "pg";

const SCHEMA = `"ferreteriarepublica"`;
const COMODIN = /^(GENERAL|VARIOS)$/i;

const STOP = new Set(["DE","DEL","LA","EL","LOS","LAS","PARA","POR","CON","SIN","Y","A","EN","X","P","C","S","UN","UNA","AL"]);
function tokens(s: string): string[] {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, " ").split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

interface Ejemplo { nombre: string; cat: string }
function entrenar(datos: Ejemplo[]) {
  const prior = new Map<string, number>();
  const cond = new Map<string, Map<string, number>>();
  const totalTok = new Map<string, number>();
  const vocab = new Set<string>();
  const df = new Map<string, number>();
  for (const d of datos) {
    prior.set(d.cat, (prior.get(d.cat) ?? 0) + 1);
    const ts = tokens(d.nombre);
    for (const t of new Set(ts)) df.set(t, (df.get(t) ?? 0) + 1);
    for (const t of ts) {
      vocab.add(t);
      const m = cond.get(t) ?? new Map<string, number>();
      m.set(d.cat, (m.get(d.cat) ?? 0) + 1);
      cond.set(t, m);
      totalTok.set(d.cat, (totalTok.get(d.cat) ?? 0) + 1);
    }
  }
  const N = datos.length;
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log(N / (1 + n)));
  return { cats: [...prior.keys()], prior, cond, totalTok, vocab, idf, N };
}
type Modelo = ReturnType<typeof entrenar>;

function predecir(m: Modelo, nombre: string): { cat: string; conf: number } | null {
  const ts = tokens(nombre).filter((t) => m.vocab.has(t));
  if (!ts.length) return null;
  const V = m.vocab.size;
  const sc: { cat: string; s: number }[] = [];
  for (const cat of m.cats) {
    let s = Math.log((m.prior.get(cat) ?? 1) / m.N);
    const tot = m.totalTok.get(cat) ?? 1;
    for (const t of ts) {
      const c = m.cond.get(t)?.get(cat) ?? 0;
      const w = Math.max(0.3, m.idf.get(t) ?? 1);
      s += w * Math.log((c + 0.1) / (tot + 0.1 * V));
    }
    sc.push({ cat, s });
  }
  sc.sort((a, b) => b.s - a.s);
  // Confianza = margen normalizado entre la 1ª y la 2ª candidata.
  const conf = sc[1] ? 1 / (1 + Math.exp(-(sc[0].s - sc[1].s) / 8)) : 1;
  return { cat: sc[0].cat, conf };
}

const argOf = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) { console.error("Falta SUPABASE_DB_URL"); process.exit(1); }
  const pool = new Pool({ connectionString: url });

  try {
    // ── Rollback ──
    const rb = argOf("rollback");
    if (rb) {
      const data = JSON.parse(fs.readFileSync(rb, "utf8")) as { id: string }[];
      const r = await pool.query(
        `UPDATE ${SCHEMA}.productos SET categoria_principal_id = NULL WHERE id = ANY($1::uuid[])`,
        [data.map((d) => d.id)]
      );
      console.log(`Revertidos ${r.rowCount} productos a "sin categoría".`);
      return;
    }

    const apply = has("apply");
    const umbral = Number(argOf("umbral") ?? "0.9");
    console.log(`Modo: ${apply ? "APLICAR" : "DRY-RUN"}   umbral: ${umbral}`);

    const { rows } = await pool.query<{ id: string; nombre: string; cat: string | null }>(
      `SELECT p.id, p.nombre, c.nombre AS cat
       FROM ${SCHEMA}.productos p
       LEFT JOIN ${SCHEMA}.categorias_productos c ON c.id = p.categoria_principal_id`
    );
    const conCat = rows.filter((r) => r.cat).map((r) => ({ nombre: r.nombre, cat: r.cat! }));
    const sinCat = rows.filter((r) => !r.cat);
    // Los comodines no sirven como destino: entrenamos sin ellos.
    const train = conCat.filter((d) => !COMODIN.test(d.cat));
    console.log(`entrenamiento: ${train.length} (de ${conCat.length}, excluyendo comodines)`);
    console.log(`sin categoría: ${sinCat.length}`);

    // ── Autoevaluación por holdout, para reportar precisión esperada ──
    const test = train.filter((_, i) => i % 5 === 0);
    const mv = entrenar(train.filter((_, i) => i % 5 !== 0));
    let ok = 0, ev = 0;
    for (const t of test) {
      const p = predecir(mv, t.nombre);
      if (!p || p.conf < umbral) continue;
      ev++; if (p.cat === t.cat) ok++;
    }
    console.log(`precisión estimada (holdout): ${(ok / ev * 100).toFixed(1)}% sobre ${ev} casos`);

    // ── Modelo final y propuesta ──
    const m = entrenar(train);
    const catIds = new Map<string, string>(
      (await pool.query<{ id: string; nombre: string }>(
        `SELECT id, nombre FROM ${SCHEMA}.categorias_productos`
      )).rows.map((r) => [r.nombre, r.id])
    );

    const asignaciones: { id: string; nombre: string; cat: string; conf: number }[] = [];
    for (const r of sinCat) {
      const p = predecir(m, r.nombre);
      if (!p || p.conf < umbral || !catIds.has(p.cat)) continue;
      asignaciones.push({ id: r.id, nombre: r.nombre, cat: p.cat, conf: p.conf });
    }

    const porCat = new Map<string, number>();
    for (const a of asignaciones) porCat.set(a.cat, (porCat.get(a.cat) ?? 0) + 1);
    console.log(`\nA asignar: ${asignaciones.length} de ${sinCat.length} (${(asignaciones.length / sinCat.length * 100).toFixed(1)}%)`);
    console.log(`Quedan sin categoría: ${sinCat.length - asignaciones.length}`);
    console.log(`\n--- top categorías ---`);
    console.log([...porCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
      .map(([c, n]) => `${c}(${n})`).join("  "));
    console.log(`\n--- 15 muestras ---`);
    for (const a of asignaciones.slice(0, 15)) {
      console.log(`  ${a.nombre.slice(0, 44).padEnd(44)} -> ${a.cat.padEnd(22)} ${(a.conf * 100).toFixed(0)}%`);
    }

    if (!apply) { console.log("\nDRY-RUN: no se escribió nada. Agregá --apply."); return; }

    // ── Aplicar en lotes, agrupando por categoría ──
    const porCatIds = new Map<string, string[]>();
    for (const a of asignaciones) {
      const cid = catIds.get(a.cat)!;
      (porCatIds.get(cid) ?? porCatIds.set(cid, []).get(cid)!).push(a.id);
    }
    let total = 0;
    for (const [cid, ids] of porCatIds) {
      const r = await pool.query(
        `UPDATE ${SCHEMA}.productos SET categoria_principal_id = $1::uuid
         WHERE id = ANY($2::uuid[]) AND categoria_principal_id IS NULL`,
        [cid, ids]
      );
      total += r.rowCount ?? 0;
    }
    const out = `categorias-asignadas-${asignaciones.length}.json`;
    fs.writeFileSync(out, JSON.stringify(asignaciones, null, 1));
    console.log(`\nActualizados: ${total}`);
    console.log(`Detalle para revertir: ${out}`);
    console.log(`Revertir con:  npx tsx scripts/asignar-categorias-faltantes.ts --rollback ${out}`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
