import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Hero } from './ui/hero-1';

export function AuthGate() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (!supabase) {
      setError('Supabase não configurado.');
      return;
    }

    setLoading(true);
    
    const adminEmail = 'admin@camply.crm';

    // 1. Tentar fazer login normal
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: adminEmail,
      password,
    });

    if (signInData.session) {
      window.location.reload(); // Reload to trigger auth state change
      return;
    }

    // 2. Se falhou, tentamos registrar silenciosamente (caso seja o primeiro acesso)
    if (signInError) {
      // If it's a genuine invalid password for an existing account, the error is usually "Invalid login credentials"
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: adminEmail,
        password,
      });

      if (signUpData.session) {
        window.location.reload();
      } else if (signUpError?.message.includes('already registered') || signUpError?.status === 422) {
        setError(`Erro: ${signInError.message} (Tente usar uma senha com pelo menos 6 caracteres se for o primeiro acesso)`);
      } else {
        setError(`Erro: ${signUpError?.message || signInError.message}`);
      }
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
                autoFocus
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
