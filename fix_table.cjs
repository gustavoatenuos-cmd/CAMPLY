const fs = require('fs');

const path = 'src/components/performance/ClientPerformanceTable.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('processClientStrategy')) {
  content = content.replace(
    /import \{ RefreshCw \} from 'lucide-react';/,
    `import { RefreshCw } from 'lucide-react';
import { processClientStrategy } from '../../lib/strategy/strategyDecisionEngine';`
  );
}

// Map the labels
content = content.replace(/partial:\s*'Sincronização parcial',/, "partial:        'Dados incompletos',");
content = content.replace(/period_not_synced:\s*'Período não sincronizado',/, "period_not_synced: 'Sem dados no período',");
content = content.replace(/never_synced:\s*'Nunca sincronizado',/, "never_synced:   'Não sincronizada',");

// Update grid cols
const oldGridStr = /grid-cols-\[260px_120px_120px_95px_110px_80px_105px_85px_105px_135px_145px\]/g;
content = content.replace(oldGridStr, "grid-cols-[260px_140px_140px_140px_160px_180px_140px]");

// Update headers
const headersRegex = /<div className="px-4 py-3">Cliente \/ conta<\/div>[\s\S]*?<div className="px-4 py-3">Dados<\/div>/;
const newHeaders = `<div className="px-4 py-3">Cliente / conta</div>
              <div className="px-4 py-3">Investimento</div>
              <div className="px-4 py-3">Orçamento</div>
              <div className="px-4 py-3">Pacing</div>
              <div className="px-4 py-3">Estratégia</div>
              <div className="px-4 py-3">Qualidade dos Dados</div>
              <div className="px-4 py-3">Ação</div>`;
content = content.replace(headersRegex, newHeaders);

// Now for the desktop row data rendering
// We need to replace the columns 4 to 11 with the new structure.
// I will parse the row and replace the children.

// Replace the row definition
const rowRegex = /\{\/\* Colunas 4—9: métricas \*\/\}[\s\S]*?\{\/\* Coluna 11: Dados \+ hover CTA \*\/\}/;
// Actually we can do it manually by finding the start and end of the block.

fs.writeFileSync(path, content, 'utf8');
console.log('Done partially. Manual edit for the rest.');
