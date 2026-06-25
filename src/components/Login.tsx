import { ArrowRight, CalendarCheck, Columns3, WalletCards } from 'lucide-react';
import { FormEvent, useState } from 'react';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onLogin();
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Assistente operacional de tráfego
          </div>
          <h1 className="max-w-3xl text-4xl font-black leading-tight tracking-tight md:text-6xl">
            O painel para saber o que precisa da sua atenção hoje.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-300">
            Campanhas, clientes, recebimentos, projetos e próximas ações em um só lugar para a rotina do Gustavo.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <Feature icon={Columns3} title="Campanhas" />
            <Feature icon={WalletCards} title="Recebimentos" />
            <Feature icon={CalendarCheck} title="Rotina diária" />
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <div className="mb-7">
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-emerald-400 text-xl font-black text-slate-950">C</div>
            <h2 className="text-2xl font-bold">Entrar no Camply</h2>
            <p className="mt-2 text-sm text-slate-400">MVP local para validar a operação antes do banco de dados.</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-300">E-mail</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-emerald-400"
                placeholder="gustavo@email.com"
                required
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-300">Senha</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-emerald-400"
                placeholder="Digite qualquer senha nesta versão"
                required
              />
            </label>
            <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-emerald-300">
              Acessar sistema
              <ArrowRight size={18} />
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

const Feature = ({ icon: Icon, title }: { icon: typeof Columns3; title: string }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
    <Icon className="text-emerald-400" size={22} />
    <p className="mt-3 font-semibold">{title}</p>
  </div>
);
