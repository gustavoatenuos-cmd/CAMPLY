import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Modal } from '../ui/Modal';
import { X, Search } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  syncRunId: string;
}

export function ReconciliationModal({ isOpen, onClose, syncRunId }: Props) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && syncRunId) {
      setLoading(true);
      supabase!.from('meta_normalized_metrics')
        .select('*')
        .eq('sync_run_id', syncRunId)
        .then(({ data: metrics, error: err }) => {
          if (err) setError(err.message);
          else setData(metrics || []);
          setLoading(false);
        });
    }
  }, [isOpen, syncRunId]);

  return (
    <Modal open={isOpen} onClose={onClose} title="Conciliação de Dados Meta Ads">
      <div className="p-4 space-y-4 text-sm text-white">
        {loading && <p>Carregando snapshots...</p>}
        {error && <p className="text-red-500">{error}</p>}
        {!loading && !error && data.length === 0 && <p>Nenhum dado encontrado para o Sync ID {syncRunId}.</p>}
        {!loading && data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="py-2">Campanha</th>
                  <th>Período</th>
                  <th>Métrica</th>
                  <th>Valor Normalizado</th>
                </tr>
              </thead>
              <tbody>
                {data.map(r => (
                  <tr key={r.id} className="border-b border-gray-800">
                    <td className="py-2 text-xs truncate max-w-[150px]">{r.campaign_id}</td>
                    <td className="text-xs">{r.date_start} a {r.date_stop}</td>
                    <td>{r.metric_id}</td>
                    <td className="font-mono text-green-400">{r.metric_value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
