const fs = require('fs');

let ov = fs.readFileSync('src/components/OverviewView.tsx', 'utf8');

// 1. Imports
ov = ov.replace(
  'Users,\n} from \'lucide-react\';',
  'Users,\n  LayoutGrid,\n  List,\n} from \'lucide-react\';'
);

ov = ov.replace(
  "import { ClientPerformanceTable } from './performance/ClientPerformanceTable';",
  "import { ClientPerformanceTable } from './performance/ClientPerformanceTable';\nimport { ClientPerformanceCardGrid } from './performance/ClientPerformanceCardGrid';"
);

// 2. State
ov = ov.replace(
  "const [subsegmentFilter, setSubsegmentFilter] = useState(storedFilters.subsegment || 'all');",
  "const [subsegmentFilter, setSubsegmentFilter] = useState(storedFilters.subsegment || 'all');\n\n  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {\n    return (sessionStorage.getItem('camply:dashboard-view-mode') as 'cards' | 'table') || 'cards';\n  });\n\n  // Salva no sessionStorage quando alterar\n  useEffect(() => {\n    sessionStorage.setItem('camply:dashboard-view-mode', viewMode);\n  }, [viewMode]);"
);

// 3. Render
ov = ov.replace(
  "<ClientPerformanceTable clients={sortedClients} period={period} />",
  `<div className="flex items-center justify-between my-2">
              <h2 className="text-lg font-black text-white">Performance</h2>
              <div className="flex items-center gap-1 rounded-lg bg-black/20 p-1">
                <button
                  onClick={() => setViewMode('cards')}
                  className={\`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold transition \${viewMode === 'cards' ? 'bg-brand-surface text-brand-green shadow' : 'text-brand-muted hover:text-white'}\`}
                >
                  <LayoutGrid size={16} />
                  Cards
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={\`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold transition \${viewMode === 'table' ? 'bg-brand-surface text-brand-green shadow' : 'text-brand-muted hover:text-white'}\`}
                >
                  <List size={16} />
                  Tabela
                </button>
              </div>
            </div>

            {viewMode === 'cards' ? (
              <ClientPerformanceCardGrid 
                clients={sortedClients} 
                workspaceClients={data.clients}
                period={period} 
              />
            ) : (
              <ClientPerformanceTable clients={sortedClients} period={period} />
            )}`
);

fs.writeFileSync('src/components/OverviewView.tsx', ov, 'utf8');
