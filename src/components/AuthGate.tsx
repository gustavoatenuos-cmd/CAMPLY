import { FormEvent, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { verifyPassword } from '../auth';

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
    setLoading(false);

    if (!valid) {
      setError('Senha incorreta.');
      return;
    }

    onUnlock();
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

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">Senha</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-brand-line bg-brand-ink px-4 py-3 text-white outline-none transition focus:border-brand-green"
              autoFocus
              required
            />
          </label>

          {error && <p className="text-sm font-semibold text-rose-400">{error}</p>}

          <button
            disabled={loading}
            className="w-full rounded-lg bg-brand-green px-4 py-3 font-bold text-brand-ink transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? 'Verificando...' : 'Acessar painel'}
          </button>
        </form>
      </section>
    </main>
  );
}
