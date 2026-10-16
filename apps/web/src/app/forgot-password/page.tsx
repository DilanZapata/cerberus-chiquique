'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { requestPasswordResetCode, resetPasswordWithCode } from '@/lib/api';

type Step = 'email' | 'code';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { message } = await requestPasswordResetCode(email);
      setInfo(message);
      setStep('code');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('Las contrasenas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      await resetPasswordWithCode(email, code, newPassword);
      router.push('/login');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Restablecer contrasena</h1>
        <p className="mt-1 text-sm text-slate-500">
          {step === 'email'
            ? 'Escribe tu correo y te enviaremos un codigo.'
            : 'Escribe el codigo que llego a tu correo y tu nueva contrasena.'}
        </p>

        {error && <p className="mt-4 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        {info && step === 'code' && <p className="mt-4 rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">{info}</p>}

        {step === 'email' ? (
          <form onSubmit={handleRequestCode}>
            <label className="mt-6 block text-sm font-medium text-slate-700">Correo</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? 'Enviando...' : 'Enviar codigo'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetPassword}>
            <label className="mt-4 block text-sm font-medium text-slate-700">Codigo de 6 digitos</label>
            <input
              type="text"
              required
              autoFocus
              maxLength={6}
              inputMode="numeric"
              pattern="[0-9]{6}"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.5em]"
            />

            <label className="mt-4 block text-sm font-medium text-slate-700">Nueva contrasena</label>
            <input
              type="password"
              required
              minLength={4}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

            <label className="mt-4 block text-sm font-medium text-slate-700">Confirmar contrasena</label>
            <input
              type="password"
              required
              minLength={4}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Restablecer contrasena'}
            </button>

            <button
              type="button"
              onClick={() => setStep('email')}
              className="mt-2 w-full text-center text-xs text-slate-500 underline hover:text-slate-700"
            >
              Usar otro correo / pedir otro codigo
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-slate-500 underline hover:text-slate-700">
            Volver a iniciar sesion
          </Link>
        </p>
      </div>
    </main>
  );
}
