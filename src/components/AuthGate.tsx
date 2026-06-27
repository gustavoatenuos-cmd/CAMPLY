import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Hero } from './ui/hero-1';

export function AuthGate() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!supabase) {
      setError('Supabase não configurado.');
      return;
    }

    setLoading(true);

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInData.session) {
      window.location.reload();
      return;
    }

    if (signInError) {
      setError('E-mail ou senha incorretos.');
    }
    
    setLoading(false);
  };

  const handleResetPassword = async () => {
    if (!email) {
      setError('Preencha seu e-mail primeiro para recuperar a senha.');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    
    const { error } = await supabase!.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin
    });
    
    setLoading(false);
    
    if (error) {
      setError('Erro ao enviar e-mail de recuperação: ' + error.message);
    } else {
      setMessage('E-mail de recuperação enviado! Verifique sua caixa de entrada.');
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
                aria-label="E-mail de Acesso"
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
                placeholder="Sua senha"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-full border border-white/20 bg-white/5 px-6 py-3 text-center text-white outline-none transition placeholder:text-gray-400 focus:border-white/50"
                required
              />

              {error && <p role="alert" className="text-sm font-medium text-rose-400">{error}</p>}
              {message && <p role="alert" className="text-sm font-medium text-brand-green">{message}</p>}

              <button
                disabled={loading}
                className="mt-2 w-full rounded-full bg-white px-8 py-3 font-semibold text-black transition hover:bg-gray-200 disabled:cursor-wait disabled:opacity-70"
              >
                {loading ? 'Processando...' : 'Entrar'}
              </button>
              
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={loading}
                className="mt-4 text-sm font-semibold text-brand-soft hover:text-white transition"
              >
                Esqueci minha senha
              </button>
            </form>
          </section>
        </div>
      </Hero>
    </div>
  );
}
