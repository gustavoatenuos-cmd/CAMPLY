import { FormEvent, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { supabase } from '../lib/supabase';
import { Hero } from './ui/hero-1';

export function AuthGate() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (!supabase) {
      setError('Supabase não está configurado. Verifique as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.');
      return;
    }

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (signInError) {
      setError('E-mail ou senha inválidos.');
    }
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
                type="email"
                aria-label="E-mail"
                autoComplete="email"
                placeholder="Seu e-mail"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-full border border-white/20 bg-white/5 px-6 py-3 text-center text-white outline-none transition placeholder:text-gray-400 focus:border-white/50"
                autoFocus
                required
              />
              <input
                type="password"
                aria-label="Senha"
                autoComplete="current-password"
                placeholder="Sua senha"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-full border border-white/20 bg-white/5 px-6 py-3 text-center text-white outline-none transition placeholder:text-gray-400 focus:border-white/50"
                required
              />

              {error && <p role="alert" className="text-sm font-medium text-rose-400">{error}</p>}

              <button
                disabled={loading}
                className="mt-2 w-fit rounded-full bg-white px-8 py-3 font-semibold text-black transition hover:bg-gray-200 disabled:cursor-wait disabled:opacity-70 md:w-52"
              >
                {loading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>
          </section>
        </div>
      </Hero>
    </div>
  );
}
