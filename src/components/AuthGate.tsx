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

    // Garantir sessão Supabase válida (necessária para as Edge Functions da Meta)
    if (supabase) {
      try {
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        
        if (existingSession) {
          // Sessão já existe — perfeito, não precisa fazer nada
          console.log('[AUTH] Sessão Supabase existente encontrada ✅');
        } else {
          console.log('[AUTH] Nenhuma sessão encontrada. Criando...');
          let sessionCreated = false;

          // Tentativa 1: Login anônimo (sem email, sem rate limit)
          const { data: anonData, error: anonErr } = await supabase.auth.signInAnonymously();
          if (!anonErr && anonData?.session) {
            console.log('[AUTH] Login anônimo OK ✅');
            sessionCreated = true;
          } else {
            console.warn('[AUTH] Login anônimo falhou:', anonErr?.message);

            // Tentativa 2: Login com email fixo
            const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
              email: 'admin@camply.crm',
              password,
            });
            if (!signInErr && signInData?.session) {
              console.log('[AUTH] Login email/senha OK ✅');
              sessionCreated = true;
            } else {
              console.warn('[AUTH] Login email/senha falhou:', signInErr?.message);

              // Tentativa 3: Criar conta
              const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
                email: 'admin@camply.crm',
                password,
                options: { data: { role: 'admin' } },
              });
              if (!signUpErr && signUpData?.session) {
                console.log('[AUTH] Criação de conta OK ✅');
                sessionCreated = true;
              } else {
                console.error('[AUTH] Criação de conta falhou:', signUpErr?.message);
              }
            }
          }

          if (!sessionCreated) {
            // Mostra diagnóstico para o usuário reportar
            console.error('[AUTH] FALHA: Nenhum método de autenticação Supabase funcionou.');
            console.error('[AUTH] A integração Meta pode não funcionar.');
          }
        }
      } catch (e: any) {
        console.error('[AUTH] Erro inesperado:', e.message);
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
