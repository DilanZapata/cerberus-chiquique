'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bootstrapCompanyMaster, getMasterStatus, MasterStatus, resetDatabaseMaster } from '@/lib/api';

const RESET_PHRASE = 'ELIMINAR TODO';

const inputClass =
  'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none';

/**
 * Panel maestro: fuera del login normal, protegido por una contrasena
 * separada (MASTER_RESET_PASSWORD en el .env del backend, no un usuario de
 * la base de datos). Deliberadamente sin link en la navegacion — es para un
 * unico operador de confianza, no para uso cotidiano.
 */
export default function MasterPage() {
  const router = useRouter();
  const [masterPassword, setMasterPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState<MasterStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [resetDone, setResetDone] = useState(false);

  const [bootstrapDone, setBootstrapDone] = useState<{ email: string } | null>(null);
  const [legalName, setLegalName] = useState('');
  const [nit, setNit] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminNationalId, setAdminNationalId] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  async function refreshStatus(pwd: string) {
    const s = await getMasterStatus(pwd);
    setStatus(s);
  }

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await refreshStatus(masterPassword);
      setUnlocked(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await resetDatabaseMaster(masterPassword, confirmationPhrase);
      setResetDone(true);
      setShowResetConfirm(false);
      setConfirmationPhrase('');
      await refreshStatus(masterPassword);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBootstrap(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await bootstrapCompanyMaster(masterPassword, {
        legalName,
        nit,
        tradeName: tradeName || undefined,
        adminFullName,
        adminNationalId,
        adminEmail,
        adminPassword,
      });
      setBootstrapDone({ email: result.admin.email });
      await refreshStatus(masterPassword);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!unlocked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
        <form onSubmit={handleUnlock} className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Panel maestro</h1>
          <p className="mt-1 text-sm text-slate-500">Acceso restringido. No es tu contrasena de admin habitual.</p>

          {error && <p className="mt-4 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

          <label className="mt-6 block text-sm font-medium text-slate-700">Contrasena maestra</label>
          <input
            type="password"
            required
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
            className={inputClass}
          />

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Verificando...' : 'Entrar'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">Panel maestro</h1>

        {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Estado actual de la base de datos</h2>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md bg-slate-100 p-3">
              <div className="text-lg font-bold text-slate-900">{status?.companies ?? '—'}</div>
              <div className="text-xs text-slate-500">Empresas</div>
            </div>
            <div className="rounded-md bg-slate-100 p-3">
              <div className="text-lg font-bold text-slate-900">{status?.users ?? '—'}</div>
              <div className="text-xs text-slate-500">Usuarios</div>
            </div>
            <div className="rounded-md bg-slate-100 p-3">
              <div className="text-lg font-bold text-slate-900">{status?.timeLogs ?? '—'}</div>
              <div className="text-xs text-slate-500">Marcas</div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-red-900">Zona de peligro</h2>
          <p className="mt-1 text-xs text-red-700">
            Borra TODAS las empresas, empleados, marcas, novedades y fotos de evidencia. No se puede deshacer.
          </p>

          {resetDone && (
            <p className="mt-3 rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">
              Base de datos reiniciada. Crea tu empresa en el formulario de abajo.
            </p>
          )}

          {!showResetConfirm ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="mt-4 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Borrar TODO y reiniciar
            </button>
          ) : (
            <form onSubmit={handleReset} className="mt-4 space-y-2">
              <label className="block text-sm font-medium text-red-900">
                Escribe exactamente <code className="rounded bg-red-100 px-1">{RESET_PHRASE}</code> para confirmar
              </label>
              <input
                required
                value={confirmationPhrase}
                onChange={(e) => setConfirmationPhrase(e.target.value)}
                className={inputClass}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading || confirmationPhrase !== RESET_PHRASE}
                  className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {loading ? 'Borrando...' : 'Confirmar borrado'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowResetConfirm(false);
                    setConfirmationPhrase('');
                  }}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Crear primera empresa y administrador</h2>
          <p className="mt-1 text-xs text-slate-500">
            Para arrancar desde cero (despues de un reset, o en una instalacion nueva).
          </p>

          {bootstrapDone ? (
            <div className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">
              Empresa creada. Ya puedes{' '}
              <button onClick={() => router.push('/login')} className="font-semibold underline">
                iniciar sesion
              </button>{' '}
              con {bootstrapDone.email}.
            </div>
          ) : (
            <form onSubmit={handleBootstrap} className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">Razon social</label>
                <input required value={legalName} onChange={(e) => setLegalName(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">NIT</label>
                <input required value={nit} onChange={(e) => setNit(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Nombre comercial (opcional)</label>
                <input value={tradeName} onChange={(e) => setTradeName(e.target.value)} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Nombre del admin</label>
                  <input required value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Cedula del admin</label>
                  <input required value={adminNationalId} onChange={(e) => setAdminNationalId(e.target.value)} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Correo del admin</label>
                <input
                  type="email"
                  required
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Contrasena del admin</label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {loading ? 'Creando...' : 'Crear empresa'}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
