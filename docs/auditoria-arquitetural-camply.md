# Auditoria Arquitetural - CAMPLY

## 1. Visão Geral
O CAMPLY é uma central operacional para gestores de tráfego, integrando dados de mídia (Meta Ads), contexto comercial, financeiro e operação em prioridades acionáveis.
Atualmente, o sistema sofre de um forte acoplamento entre as operações cotidianas (tasks, recebíveis, campanhas locais) e a integração analítica (Meta Ads), além de uma persistência legada monolítica baseada em um único grande objeto JSONB.

## 2. Diagnóstico de Arquitetura

### 2.1 Ponto Único de Falha e Acoplamento Visual (Dashboard)
A tela "Hoje" está excessivamente dependente da disponibilidade de dados da Meta. Quando a Meta falha, o operador perde a visibilidade das tarefas, projetos e cobranças porque a prioridade visual é inteiramente dominada pelo Dashboard de Performance de Mídia.

### 2.2 Motores Concorrentes de Regras de Negócio
Existem múltiplos motores (e.g. `buildInsights` no `camplyStore.ts`, regras em `AlertCenterView`, avaliações no `ClientPerformanceCardGrid`) determinando a prioridade, muitas vezes de forma conflitante. Uma campanha pode estar "ok" numa tela e "atrasada" noutra. A tela de configurações (`AgentSettingsView`) provê controles que não são consumidos uniformemente, tornando-se decorativos.

### 2.3 Persistência em Workspace Monolítico (JSONB)
A maior parte do domínio operacional (`clients`, `projects`, `tasks`, `receivables`, `campaigns`) é armazenada em uma tabela (`camply_workspace`) dentro de uma única coluna `data` (JSONB).
Isso causa:
- Crescimento descontrolado do payload (necessidade de tetos arbitrários como `MAX_ACTIVITY_LOGS`).
- Condição de corrida (conflitos) entre abas ou dispositivos, pois o front-end lê tudo, altera um item e salva tudo por cima.
- Impossibilidade de fazer queries relacionais ricas no Supabase.
- Risco de perda de dados parciais quando a gravação de um perfil (e.g. `client_identity` vs JSONB) não for atômica.

### 2.4 Domínios Semânticos Confusos e Sobrepostos
O domínio `Campaign` mistura planejamento operacional (verba planejada, nome interno, responsável) com metadados analíticos (ID da Meta, gasto real, ROI).
O domínio Financeiro espalha as previsões na configuração do cliente, nos projetos, e num log sintético, gerando conflitos sobre "quanto o cliente realmente pagou".

## 3. Diretrizes de Evolução (Arquitetura-Alvo)
- **Desacoplamento Visual e Lógico:** A operação (tarefas, finanças) deve rodar independentemente dos dados externos (Meta).
- **Camada Central de Inteligência (Sinal Operacional):** Avaliação de regras move-se para o back-end ou biblioteca central isolada. Todas as telas consomem os mesmos "Sinais" normalizados.
- **Normalização Relacional (Faseada):** Desmembramento do JSONB em tabelas independentes (ex: `tasks`, `receivables`, `operational_campaigns`, `projects`) com IDs persistentes.
- **Transacionalidade:** O fluxo de cadastro e atualização de perfis operacionais e analíticos será coberto por RPCs com garantias de atomicidade.
