"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [identificador, setIdentificador] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ identificador }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setError(typeof json?.error === "string" ? json.error : "Demasiadas solicitudes. Esperá unos minutos.");
        return;
      }
      // Siempre genérico (no revela si la cuenta existe).
      setMessage(
        typeof json?.message === "string"
          ? json.message
          : "Si existe una cuenta asociada, recibirás un enlace para restablecer tu contraseña."
      );
      setDone(true);
    } catch {
      setError("No se pudo procesar la solicitud. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setLoading(false);
    }
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

        <p className="text-center text-sm text-sky-100/90">Recuperá el acceso a tu cuenta</p>

        <div className="w-full rounded-2xl border border-white/20 bg-white/[0.97] p-5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.38)] backdrop-blur-md sm:p-6">
          {done ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {message}
              </div>
              <p className="text-xs text-slate-500">
                Revisá tu bandeja de entrada (y la carpeta de spam). El enlace te llevará a crear una contraseña nueva.
              </p>
              <Link
                href="/login"
                className="block w-full rounded-lg bg-[#0EA5E9] px-4 py-2.5 text-center font-medium text-white shadow-sm transition-colors hover:bg-[#0284C7]"
              >
                Volver a iniciar sesión
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#0F172A]">Usuario o correo electrónico</label>
                <input
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={identificador}
                  onChange={(e) => setIdentificador(e.target.value)}
                  placeholder="carlos  o  usuario@empresa.com"
                  required
                  autoFocus
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] transition-all placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Te enviaremos un enlace de recuperación al correo asociado a tu cuenta.
                </p>
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
                {loading ? "Enviando…" : "Enviar enlace de recuperación"}
              </button>

              <div className="text-center">
                <Link href="/login" className="text-xs font-medium text-[#0EA5E9] hover:text-[#0284C7]">
                  Volver a iniciar sesión
                </Link>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-[11px] text-sky-200/55 sm:text-xs">Acceso restringido</p>
      </div>
    </div>
  );
}
