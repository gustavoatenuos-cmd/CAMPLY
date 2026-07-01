import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Hero } from './ui/hero-1';

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
    <div className="min-h-screen bg-black text-white">
      <Hero
        title="Gestão de Tráfego Inteligente"
        subtitle="Otimize suas campanhas e aumente a produtividade com segurança, velocidade e simplicidade."
        eyebrow="Camply CRM"
      >
        <div className="mt-4 flex w-full justify-center">
          <section className="w-full max-w-sm text-center">
            <form onSubmit={submit} className="flex flex-col items-center space-y-4">
              <input
                type="password"
                aria-label="Senha de Acesso Mestre"
                placeholder="Senha de Acesso Mestre"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-full border border-white/20 bg-white/5 px-6 py-3 text-center text-white outline-none transition placeholder:text-gray-400 focus:border-white/50"
                autoComplete="current-password"
                autoFocus
                required
              />

              {error && <p role="alert" className="text-sm font-medium text-rose-400">{error}</p>}

              <button
                data-testid="login-submit"
                disabled={loading}
                className="mt-2 w-full rounded-full bg-white px-8 py-3 font-semibold text-black transition hover:bg-gray-200 disabled:cursor-wait disabled:opacity-70"
              >
                {loading ? 'Processando...' : 'Entrar'}
              </button>
            </form>
          </section>
        </div>
      </Hero>
    </div>
  );
}
