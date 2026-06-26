import { FormEvent, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { supabase } from '../lib/supabase';

interface AuthGateProps {
  onUnlock: () => void;
}

export function AuthGate({ onUnlock }: AuthGateProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (isLogin) {
      const { data, error } = await supabase!.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
      } else if (data.session) {
        onUnlock();
      }
    } else {
      const { data, error } = await supabase!.auth.signUp({
        email,
        password,
      });

      if (error) {
        setError(error.message);
      } else {
        setMessage('Conta criada com sucesso! Você já pode fazer login.');
        setIsLogin(true);
      }
    }

    setLoading(false);
  };

  return (
    <main className="grid min-h-screen place-items-center bg-brand-ink p-6 text-white">
      <section className="w-full max-w-md rounded-2xl border border-brand-line bg-brand-surface p-6 shadow-brand">
        <div className="mb-8">
          <BrandLogo inverted />
          <p className="mt-5 text-sm leading-relaxed text-brand-muted">
            Acesso restrito ao painel operacional.
          </p>
        </div>

        <div className="mb-6 flex gap-4 border-b border-brand-line pb-2">
          <button 
            className={`font-semibold ${isLogin ? 'text-white' : 'text-brand-soft'}`}
            onClick={() => { setIsLogin(true); setError(''); setMessage(''); }}
          >
            Login
          </button>
          <button 
            className={`font-semibold ${!isLogin ? 'text-white' : 'text-brand-soft'}`}
            onClick={() => { setIsLogin(false); setError(''); setMessage(''); }}
          >
            Criar Conta
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-brand-line bg-brand-ink px-4 py-3 text-white outline-none transition focus:border-brand-green"
              autoFocus
              required
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">Senha</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-brand-line bg-brand-ink px-4 py-3 text-white outline-none transition focus:border-brand-green"
              required
            />
          </label>

          {error && <p className="text-sm font-semibold text-rose-400">{error}</p>}
          {message && <p className="text-sm font-semibold text-brand-green">{message}</p>}

          <button
            disabled={loading}
            className="w-full rounded-lg bg-brand-green px-4 py-3 font-bold text-brand-ink transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? 'Processando...' : isLogin ? 'Acessar painel' : 'Registrar'}
          </button>
        </form>
      </section>
    </main>
  );
}
