import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/productos/sku-sugerencias?tipo=<reventa|menu|materia>
 *
 * Devuelve:
 *  - sugerido: SKU autogenerado para el tipo (REV/MEN/MP) con el próximo número.
 *  - patrones: prefijos detectados en SKUs existentes + los por tipo, cada uno
 *    con su "siguiente" (próximo número), para el dropdown "Usar patrón existente".
 * Solo lectura sobre productos.sku. No toca ventas/compras.
 */

const PREFIJO_TIPO: Record<string, string> = { reventa: "REV", menu: "MEN", materia: "MP" };

function pad(n: number, width: number): string {
  return String(n).padStart(Math.max(width, 1), "0");
}

/** Separa "QA-MAY-001" → {prefix:"QA-MAY", num:1, width:3}. Si no hay número final, null. */
function parseSku(sku: string): { prefix: string; num: number; width: number } | null {
  const m = /^(.+?)[-_](\d+)$/.exec(sku.trim());
  if (!m) return null;
  return { prefix: m[1], num: parseInt(m[2], 10) || 0, width: m[2].length };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const tipo = (new URL(request.url).searchParams.get("tipo") ?? "reventa").toLowerCase();
    const prefijoTipo = PREFIJO_TIPO[tipo] ?? "REV";

    const { data, error } = await ctx.supabase
      .from("productos")
      .select("sku")
      .eq("empresa_id", ctx.auth.empresa_id);
    if (error) throw new Error(error.message);

    // prefix -> { maxNum, width }
    const map = new Map<string, { maxNum: number; width: number }>();
    for (const r of (data ?? []) as Array<{ sku: string | null }>) {
      const p = r.sku ? parseSku(r.sku) : null;
      if (!p) continue;
      const cur = map.get(p.prefix);
      if (!cur) map.set(p.prefix, { maxNum: p.num, width: p.width });
      else map.set(p.prefix, { maxNum: Math.max(cur.maxNum, p.num), width: Math.max(cur.width, p.width) });
    }

    // Asegurar que los 3 prefijos por tipo existan en la lista (aunque no se hayan usado).
    for (const px of Object.values(PREFIJO_TIPO)) {
      if (!map.has(px)) map.set(px, { maxNum: 0, width: 4 });
    }

    const patrones = [...map.entries()]
      .map(([prefix, v]) => ({
        prefix,
        siguiente: `${prefix}-${pad(v.maxNum + 1, Math.max(v.width, 4))}`,
      }))
      .sort((a, b) => a.prefix.localeCompare(b.prefix));

    // SKU sugerido: número correlativo plano (sin prefijo), continuando la
    // numeración del catálogo del cliente. Se toma el MAYOR SKU puramente numérico
    // DIRECTO EN LA BASE con un MAX(): antes se recorría `data` (el `.select("sku")`
    // de arriba), pero PostgREST corta ese select en ~1000 filas y con 17k+
    // productos el correlativo quedaba estancado (~17344).
    //
    // Se acota a SKUs de HASTA 6 dígitos: el correlativo es de ~5 dígitos (base
    // 17079), y algunos productos tienen guardado un CÓDIGO DE BARRAS numérico
    // (12-13 dígitos) como SKU; sin este tope, el MAX saltaría a ese número de
    // barras. 6 dígitos deja amplio margen (hasta 999999) y excluye las barras.
    // Piso en SKU_BASE.
    const SKU_BASE = 17079;
    let maxNumerico = SKU_BASE;
    try {
      const pool = getChatPostgresPool();
      if (pool) {
        const schema = assertAllowedChatDataSchema(await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id));
        const t = quoteSchemaTable(schema, "productos");
        const { rows } = await pool.query(
          `SELECT COALESCE(MAX(sku::bigint), 0)::text AS maxnum
             FROM ${t}
            WHERE empresa_id = $1::uuid AND sku ~ '^[0-9]{1,6}$'`,
          [ctx.auth.empresa_id]
        );
        const dbMax = rows[0]?.maxnum != null ? Number(rows[0].maxnum) : 0;
        if (Number.isFinite(dbMax) && dbMax > maxNumerico) maxNumerico = dbMax;
      }
    } catch (e) {
      console.error("[/api/productos/sku-sugerencias] MAX sku numérico", e instanceof Error ? e.message : e);
      // Fallback: el máximo del subconjunto ya cargado (mejor que fallar).
      for (const r of (data ?? []) as Array<{ sku: string | null }>) {
        const s = (r.sku ?? "").trim();
        if (/^\d{1,6}$/.test(s)) {
          const n = parseInt(s, 10);
          if (Number.isFinite(n) && n > maxNumerico) maxNumerico = n;
        }
      }
    }
    const sugerido = String(maxNumerico + 1);

    return NextResponse.json(successResponse({ sugerido, prefijo_tipo: prefijoTipo, patrones }));
  } catch (err) {
    console.error("[/api/productos/sku-sugerencias]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron generar sugerencias de SKU."), { status: 500 });
  }
}
