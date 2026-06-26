import { FormEvent, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { supabase } from '../lib/supabase';
import { Hero } from './ui/hero-1';

interface AuthGateProps {
  onUnlock: () => void;
}

export function AuthGate({ onUnlock }: AuthGateProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    
    // Hardcoded admin email for internal single-tenant usage
    const adminEmail = 'admin@camply.com';

    // 1. Tentar fazer login normal
    const { data: signInData, error: signInError } = await supabase!.auth.signInWithPassword({
      email: adminEmail,
      password,
    });

    if (signInData.session) {
      onUnlock();
      setLoading(false);
      return;
    }

    // 2. Se falhou, tentamos registrar silenciosamente (caso seja o primeiro acesso)
    if (signInError) {
      const { data: signUpData, error: signUpError } = await supabase!.auth.signUp({
        email: adminEmail,
        password,
      });

      if (signUpData.session) {
        // Sucesso no primeiro acesso (senha configurada)
        onUnlock();
      } else if (signUpError?.message.includes('already registered') || signUpError?.status === 422) {
        // Se já existe e falhou no signIn, a senha está errada
        setError('Senha incorreta.');
      } else {
        // Outro erro qualquer (ex: senha muito fraca)
        setError(signUpError?.message || 'Erro ao validar senha.');
      }
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-brand-ink text-white scroll-smooth">
      <Hero 
        title="Gestão de Tráfego Inteligente"
        subtitle="Otimize suas campanhas e aumente a produtividade com soluções intuitivas. Segurança, velocidade e simplicidade em uma única plataforma."
        eyebrow="Camply CRM"
        ctaLabel="Acessar o Painel"
        ctaHref="#login"
      />
      <main id="login" className="grid place-items-center py-32 px-6">
        <section className="w-full max-w-md rounded-2xl border border-brand-line bg-brand-surface p-6 shadow-brand text-left">
          <div className="mb-8 text-center flex flex-col items-center">
            <BrandLogo inverted />
            <p className="mt-5 text-sm leading-relaxed text-brand-muted">
              Acesso restrito ao painel operacional.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-6">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Senha de Acesso Mestre</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-brand-line bg-brand-ink px-4 py-3 text-white outline-none transition focus:border-brand-green"
                required
              />
            </label>

            {error && <p className="text-sm font-semibold text-rose-400 text-center">{error}</p>}

            <button
              disabled={loading}
              className="w-full rounded-lg bg-brand-green px-4 py-3 font-bold text-brand-ink transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
            >
              {loading ? 'Validando...' : 'Acessar painel'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
