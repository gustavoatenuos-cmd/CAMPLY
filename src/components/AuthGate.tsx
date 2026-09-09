import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';
import { BrandLogo } from './BrandLogo';

const MASTER_LOGIN_EMAIL = import.meta.env.VITE_MASTER_LOGIN_EMAIL || 'gustavoatenuos@gmail.com';

export function AuthGate({ onMockLogin }: { onMockLogin?: () => void } = {}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (onMockLogin) {
      setLoading(true);
      onMockLogin();
      return;
    }

    if (!supabase) {
      setError('Supabase não configurado.');
      return;
    }

    setLoading(true);

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: MASTER_LOGIN_EMAIL,
      password,
    });

    if (signInData.session) {
      window.location.reload();
      return;
    }

    if (signInError) {
      setError('Senha incorreta.');
    }
    
    setLoading(false);
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-brand-ink text-white">
      {/* Background grid */}
      <div
        className="absolute inset-0 -z-10 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '4rem 4rem',
        }}
      />
      {/* Radial glow */}
      <div className="absolute top-1/3 left-1/2 -z-10 h-[500px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-green/5 blur-[120px]" />

      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="flex justify-center">
          <BrandLogo inverted />
        </div>

        <div>
          <h1 className="text-3xl font-bold tracking-tight font-sora">Gestão de Tráfego Inteligente</h1>
          <p className="mt-2 text-brand-muted">Otimize suas campanhas com segurança, velocidade e simplicidade.</p>
        </div>

        <form onSubmit={submit} className="flex flex-col items-center space-y-4">
          <input
            type="password"
            aria-label="Senha de Acesso Mestre"
            placeholder="Senha de Acesso Mestre"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-center text-white outline-none transition placeholder:text-brand-muted focus:border-brand-green/40 focus:shadow-[0_0_20px_rgba(0,229,153,0.1)]"
            autoComplete="current-password"
            autoFocus
            required
          />

          {error && <p role="alert" className="text-sm font-medium text-rose-400">{error}</p>}

          <button
            data-testid="login-submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-green px-8 py-3 font-semibold text-brand-ink transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? 'Processando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
