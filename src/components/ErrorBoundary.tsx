import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  viewName?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Camply view crashed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="flex h-full items-center justify-center bg-brand-ink p-6 text-white">
        <section className="max-w-lg rounded-2xl border border-amber-400/40 bg-amber-400/10 p-6">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200">Tela indisponível</p>
          <h2 className="mt-2 text-xl font-black">Não conseguimos renderizar esta área.</h2>
          <p className="mt-2 text-sm leading-6 text-amber-50/85">
            O restante do CAMPLY foi preservado. Troque de tela ou recarregue para tentar novamente.
          </p>
          <p className="mt-3 rounded-lg bg-black/20 p-3 text-xs text-amber-100">
            {this.props.viewName ? `${this.props.viewName}: ` : ''}{this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-lg bg-amber-200 px-4 py-2 text-sm font-black text-brand-ink"
          >
            Tentar novamente
          </button>
        </section>
      </div>
    );
  }
}
