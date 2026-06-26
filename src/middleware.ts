import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Hostnames que sirven el sitio publico estatico (HTML en public/sitio/).
 * Configurable via SITIO_HOST_REGEX. Default: ferreteriarepublica.com y subdominio www.
 */
const SITIO_HOST_REGEX = new RegExp(
  `^${process.env.SITIO_HOST_REGEX ?? "(www\\.)?ferreteriarepublica\\.com\\.py"}$`
);

function isSitioHost(host: string | null): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0];
  return SITIO_HOST_REGEX.test(hostname);
}

/**
 * Paths que NO se reescriben a /sitio/* aunque el host sea del sitio publico.
 * El sitio puede hacer fetch a /api/sitio/* desde su mismo dominio sin CORS.
 */
function isPassthroughPath(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/_next/");
}

/**
 * Rewrites por hostname.
 *  - host del sitio + "/"          -> /sitio/index.html
 *  - host del sitio + "/catalogo"  -> /sitio/catalogo.html
 *  - host del sitio + "/<asset>"   -> /sitio/<asset>  (resuelve assets relativos del HTML)
 *  - host del sitio + "/api/*"     -> passthrough (sin rewrite)
 *  - cualquier otro host           -> ERP (refresh sesion Supabase, comportamiento previo)
 */
export async function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  if (isSitioHost(host)) {
    const { pathname } = request.nextUrl;

    if (isPassthroughPath(pathname)) {
      return NextResponse.next({ request });
    }

    const url = request.nextUrl.clone();
    if (pathname === "/") {
      url.pathname = "/sitio/index.html";
    } else if (pathname === "/catalogo" || pathname === "/catalogo/") {
      // El catalogo ahora vive embebido en el home como vista SPA.
      // Servimos index.html y el JS detecta el path /catalogo para arrancar
      // directo en la vista catalogo. Preserva ?cat= y ?q= en la URL.
      url.pathname = "/sitio/index.html";
    } else if (pathname === "/favicon.ico") {
      url.pathname = "/sitio/assets/republica-icon.png";
    } else if (
      pathname.startsWith("/assets/") ||
      pathname.startsWith("/uploads/") ||
      pathname.startsWith("/sitio/") ||
      pathname === "/support.js" ||
      pathname === "/image-slot.js"
    ) {
      // Assets servidos desde public/sitio/. Si el path ya empieza con
      // /sitio/ lo dejamos pasar; sino lo prefijamos.
      if (!pathname.startsWith("/sitio/")) {
        url.pathname = `/sitio${pathname}`;
      }
    } else {
      // Path desconocido bajo host del sitio (ej. /login, /dashboard, etc.):
      // redirigir al home en vez de mostrar el 404 default de Next.
      // Es UX-friendlier para visitas accidentales del ERP.
      url.pathname = "/";
      return NextResponse.redirect(url, 302);
    }
    return NextResponse.rewrite(url);
  }

  // ===== ERP: comportamiento original (refresh sesion Supabase) =====
  // Para assets estaticos del ERP, evitar el refresh Supabase (no hace falta y
  // ahorra latencia). Como el matcher ya no excluye imagenes (necesarias para
  // los rewrites del sitio), hacemos el filtro aca.
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf)$/i.test(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  await supabase.auth.getUser();

  return supabaseResponse;
}

/**
 * Excluir `/api/webhooks/*`: Meta hace GET sin cookies para verificar el webhook;
 * no debe pasar por refresh de sesion Supabase.
 *
 * IMPORTANTE: ya no excluimos imagenes/css/js del matcher porque el sitio publico
 * (host ferreteriarepublica.com.py) necesita que los assets pasen por el middleware
 * para rewrite /assets/* -> /sitio/assets/*. Los hosts del ERP tienen early-return
 * para assets estaticos dentro del middleware (ver arriba) para no perder perf.
 */
export const config = {
  matcher: ["/((?!api/webhooks|_next/static|_next/image).*)"],
};
