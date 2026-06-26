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
    <div className="min-h-screen bg-black text-white">
      <Hero 
        title="Gestão de Tráfego Inteligente"
        subtitle="Otimize suas campanhas e aumente a produtividade com soluções intuitivas. Segurança, velocidade e simplicidade em uma única plataforma."
        eyebrow="Camply CRM"
      >
        <div className="flex justify-center w-full mt-4">
          <section className="w-full max-w-sm text-center">
            <form onSubmit={submit} className="space-y-4 flex flex-col items-center">
              <div className="w-full relative">
                <input
                  type="password"
                  placeholder="Senha de Acesso Mestre"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-full border border-white/20 bg-white/5 px-6 py-3 text-white outline-none transition focus:border-white/50 text-center placeholder:text-gray-400 backdrop-blur-sm"
                  autoFocus
                  required
                />
              </div>

              {error && <p className="text-sm font-medium text-rose-400 text-center">{error}</p>}

              <button
                disabled={loading}
                className="w-fit md:w-52 rounded-full bg-white px-8 py-3 font-semibold text-black transition hover:bg-gray-200 disabled:cursor-wait disabled:opacity-70 mt-2"
              >
                {loading ? 'Validando...' : 'Acessar painel'}
              </button>
            </form>
          </section>
        </div>
      </Hero>
    </div>
  );
}
