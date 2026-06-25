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
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
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
      url.pathname = "/sitio/catalogo.html";
    } else if (!pathname.startsWith("/sitio/")) {
      url.pathname = `/sitio${pathname}`;
    }
    return NextResponse.rewrite(url);
  }

  // ===== ERP: comportamiento original (refresh sesion Supabase) =====
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
 * no debe pasar por refresh de sesion Supabase (y queda listo para proxies estrictos).
 */
export const config = {
  matcher: [
    "/((?!api/webhooks|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
