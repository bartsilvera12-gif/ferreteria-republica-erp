import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/mem — snapshot puntual de `process.memoryUsage()` (requiere sesión).
 * Diagnóstico de la fuga: comparar `rss_mb` (lo que se mide por afuera) contra
 * `heapUsed_mb`. rss sube y heapUsed plano → fuga nativa/off-heap; suben juntos → fuga JS.
 * El log periódico equivalente vive en src/instrumentation.ts (prefijo [mem-debug]).
 */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const m = process.memoryUsage();
  const MB = (n: number) => Math.round((n / 1048576) * 10) / 10;

  return NextResponse.json(
    {
      ts: new Date().toISOString(),
      uptime_s: Math.round(process.uptime()),
      rss_mb: MB(m.rss),
      heapTotal_mb: MB(m.heapTotal),
      heapUsed_mb: MB(m.heapUsed),
      external_mb: MB(m.external),
      arrayBuffers_mb: MB(m.arrayBuffers),
    },
    { headers: { "cache-control": "no-store" } }
  );
}
