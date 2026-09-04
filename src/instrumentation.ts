/**
 * Instrumentación del servidor Next (runtime nodejs). Diagnóstico de la fuga de
 * memoria de ~1 GB/día: corre UNA vez por proceso, sin impacto en el request path.
 *
 * Qué hace:
 *  1. Loguea `process.memoryUsage()` cada N minutos a stdout (lo captura Docker).
 *     Línea única con prefijo `[mem-debug]` para grepear fácil.
 *  2. Handler SIGUSR2 → escribe un heap snapshot a archivo (para el caso "fuga JS").
 *
 * Cómo LEERLO (el discriminador clave):
 *  - Si `rss_mb` sube ~1 GB/día pero `heapUsed_mb` queda plano y suben
 *    `external_mb`/`arrayBuffers_mb` → fuga NATIVA / off-heap (Buffers, addons,
 *    fragmentación de glibc). El heap snapshot NO la va a mostrar.
 *  - Si `heapUsed_mb` sube junto con `rss_mb` → fuga en el heap de JS → mandá
 *    SIGUSR2 para capturar el snapshot y ver qué objeto crece.
 *
 * Capturar el snapshot (SOLO cuando heapUsed esté alto; congela el proceso unos
 * segundos y ~duplica la memoria momentáneamente, hacelo fuera de pico):
 *    docker exec <contenedor> sh -c 'kill -USR2 1'
 * y después sacá el archivo del contenedor:
 *    docker cp <contenedor>:/tmp/heap-<ts>.heapsnapshot ./
 * Abrilo en Chrome DevTools → Memory → Load.
 *
 * Apagar el logueo sin borrar código: env `MEM_DEBUG=0`.
 * Intervalo configurable: env `MEM_DEBUG_INTERVAL_MS` (default 300000 = 5 min).
 * Carpeta del snapshot: env `MEM_DEBUG_DIR` (default /tmp).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.MEM_DEBUG === "0") return;

  const g = globalThis as unknown as { __memDebugStarted?: boolean };
  if (g.__memDebugStarted) return;
  g.__memDebugStarted = true;

  const MB = (n: number) => Math.round((n / 1048576) * 10) / 10;
  const logMem = (tag: string) => {
    const m = process.memoryUsage();
    console.log(
      `[mem-debug] ${tag} ` +
        JSON.stringify({
          ts: new Date().toISOString(),
          uptime_s: Math.round(process.uptime()),
          rss_mb: MB(m.rss),
          heapTotal_mb: MB(m.heapTotal),
          heapUsed_mb: MB(m.heapUsed),
          external_mb: MB(m.external),
          arrayBuffers_mb: MB(m.arrayBuffers),
        })
    );
  };

  const everyMs = Number(process.env.MEM_DEBUG_INTERVAL_MS) || 300_000;
  logMem("start");
  const timer = setInterval(() => logMem("tick"), everyMs);
  // No mantener vivo el proceso solo por este timer.
  if (typeof timer.unref === "function") timer.unref();

  // SIGUSR2 → heap snapshot a archivo. Node no usa SIGUSR2 (SIGUSR1 es el debugger).
  try {
    const v8 = await import("node:v8");
    const path = await import("node:path");
    process.on("SIGUSR2", () => {
      try {
        logMem("pre-snapshot");
        const file = path.join(
          process.env.MEM_DEBUG_DIR || "/tmp",
          `heap-${Date.now()}.heapsnapshot`
        );
        const out = v8.writeHeapSnapshot(file);
        console.log(`[mem-debug] heap snapshot escrito: ${out}`);
      } catch (e) {
        console.error("[mem-debug] snapshot falló:", e instanceof Error ? e.message : e);
      }
    });
    console.log("[mem-debug] activo (SIGUSR2 → heap snapshot; MEM_DEBUG=0 para apagar)");
  } catch {
    /* v8/path no disponibles: seguimos solo con el log periódico */
  }
}
