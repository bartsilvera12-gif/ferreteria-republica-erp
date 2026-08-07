"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { clearBrowserEmpresaDataSchemaCache } from "@/lib/supabase/browser-data-client";
import { clearModuleAccessCache } from "@/lib/modulos/module-access-cache";

type Estado = "verificando" | "listo" | "invalido" | "ok";

export default function ResetPasswordPage() {
  const [estado, setEstado] = useState<Estado>("verificando");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Gate: solo permitir el cambio si hay una sesión de recuperación activa
  // (la seteó /auth/callback al intercambiar el código del email).
  useEffect(() => {
    let cancel = false;

    // Fallback: si la sesión de recuperación llega por evento (hash/async).
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!cancel && (session || event === "PASSWORD_RECOVERY")) setEstado("listo");
    });

    supabase.auth.getSession().then(({ data }) => {
      if (cancel) return;
      if (data.session) setEstado("listo");
    });

    // Si en ~2s no hay sesión, el enlace es inválido/expiró.
    const t = setTimeout(() => {
      if (!cancel) setEstado((e) => (e === "verificando" ? "invalido" : e));
    }, 2000);

    return () => {
      cancel = true;
      sub.subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== password2) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setLoading(false);
      const msg = updErr.message || "";
      if (/should be different|same as the old/i.test(msg)) {
        setError("La contraseña nueva debe ser distinta a la anterior.");
      } else {
        setError("No se pudo cambiar la contraseña. Pedí un nuevo enlace de recuperación.");
      }
      return;
    }
    // Nueva sesión válida. Limpiar caches del usuario y entrar.
    clearBrowserEmpresaDataSchemaCache();
    clearModuleAccessCache();
    setEstado("ok");
    setTimeout(() => window.location.assign("/"), 1200);
  }

  return (
    <div className="zentra-login-bg flex min-h-dvh w-full flex-col items-center justify-center overflow-x-hidden overflow-y-auto px-4 py-5 md:h-dvh md:overflow-y-hidden md:py-6">
      <div className="flex w-full max-w-[22rem] shrink-0 flex-col items-center gap-3 sm:max-w-sm sm:gap-4">
        <div className="w-full max-w-[13.5rem] shrink-0 sm:max-w-[15rem]">
          <Image
            src="/brand/zentra-logo-official.png"
            alt="ZENTRA"
            width={480}
            height={264}
            priority
            className="h-auto w-full max-h-[4.25rem] object-contain object-center sm:max-h-[4.75rem]"
          />
        </div>

        <p className="text-center text-sm text-sky-100/90">Creá una contraseña nueva</p>

        <div className="w-full rounded-2xl border border-white/20 bg-white/[0.97] p-5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.38)] backdrop-blur-md sm:p-6">
          {estado === "verificando" && (
            <p className="py-6 text-center text-sm text-slate-500">Verificando el enlace…</p>
          )}

          {estado === "invalido" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                El enlace de recuperación es inválido o expiró. Pedí uno nuevo.
              </div>
              <Link
                href="/forgot-password"
                className="block w-full rounded-lg bg-[#0EA5E9] px-4 py-2.5 text-center font-medium text-white shadow-sm transition-colors hover:bg-[#0284C7]"
              >
                Pedir nuevo enlace
              </Link>
            </div>
          )}

          {estado === "ok" && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Contraseña actualizada. Entrando…
            </div>
          )}

          {estado === "listo" && (
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#0F172A]">Contraseña nueva</label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    required
                    autoFocus
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-[#0F172A] transition-all placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 transition-colors hover:text-[#0F172A]"
                    aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#0F172A]">Confirmar contraseña</label>
                <input
                  type={showPass ? "text" : "password"}
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  placeholder="Repetir contraseña"
                  required
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] transition-all placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 sm:px-4 sm:py-3">
                  <span aria-hidden>⚠</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#0EA5E9] px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-[#0284C7] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
              >
                {loading ? "Guardando…" : "Cambiar contraseña"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-[11px] text-sky-200/55 sm:text-xs">Acceso restringido</p>
      </div>
    </div>
  );
}
