import { FormEvent, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { supabase } from '../lib/supabase';
import { verifyPassword } from '../auth';
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

    const valid = await verifyPassword(password);
    
    if (!valid) {
      setError('Senha incorreta.');
      setLoading(false);
      return;
    }

    // Tentar login silencioso para obter a sessão (necessário para as integrações Meta / RLS)
    const adminEmail = 'admin@camply.com';
    const { data: sessionData } = await supabase!.auth.getSession();
    
    if (!sessionData.session) {
      const { error: signInErr } = await supabase!.auth.signInWithPassword({
        email: adminEmail,
        password,
      });

      if (signInErr) {
        const { error: signUpErr, data: signUpData } = await supabase!.auth.signUp({
          email: adminEmail,
          password,
        });

        if (signUpErr) {
          console.error("Supabase Silent Auth Error:", signUpErr.message);
          alert(`Aviso: O login no painel funcionou, mas a autenticação com o banco de dados falhou (${signUpErr.message}). As integrações da Meta podem não funcionar.`);
        } else if (signUpData.user && !signUpData.session) {
          alert(`Aviso: O Supabase exige confirmação de e-mail. Por favor, desative a 'Email Confirmation' nas configurações de Auth do seu projeto Supabase para que a integração da Meta funcione sem e-mail.`);
        }
      }
    }

    onUnlock();
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
