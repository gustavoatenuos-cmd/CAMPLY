import React, { useState, useEffect, useRef } from 'react';
import { Mic, Send, Bot, User, MicOff, Loader2 } from 'lucide-react';
import { CamplyData, Client, Campaign, Project, Task } from '../types';
import { makeId } from '../data/camplyStore';
import { processChatCommand } from '../lib/claudeService';

interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
}

interface AgentChatViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

const CHAT_KEY = 'camply:agent-chat-history';

const DEFAULT_MESSAGES: Message[] = [
  {
    id: '1',
    role: 'agent',
    text: 'Olá! Sou seu assistente operacional. Você pode me pedir para criar clientes, campanhas, tarefas ou projetos. Pode digitar ou usar o microfone!',
  },
];

const loadInitialMessages = (): Message[] => {
  try {
    const stored = window.sessionStorage.getItem(CHAT_KEY);
    return stored ? JSON.parse(stored) as Message[] : DEFAULT_MESSAGES;
  } catch {
    return DEFAULT_MESSAGES;
  }
};

export function AgentChatView({ data, updateData }: AgentChatViewProps) {
  const [messages, setMessages] = useState<Message[]>(loadInitialMessages);
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Speech Recognition setup
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const recognition = SpeechRecognition ? new SpeechRecognition() : null;

  if (recognition) {
    recognition.continuous = false;
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => prev + (prev ? ' ' : '') + transcript);
    };

    recognition.onend = () => {
      setIsListening(false);
    };
    
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      setIsListening(false);
    };
  }

  const toggleListen = () => {
    if (!recognition) {
      alert('Seu navegador não suporta reconhecimento de voz. Tente usar o Chrome.');
      return;
    }
    
    if (isListening) {
      recognition.stop();
      setIsListening(false);
    } else {
      recognition.start();
      setIsListening(true);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-50)));
    } catch (error) {
      console.warn('Camply chat history save skipped:', error instanceof Error ? error.message : String(error));
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    
    setMessages(prev => [...prev, { id: makeId('msg'), role: 'user', text: userText }]);
    setIsLoading(true);

    try {
      const action = await processChatCommand(userText, data);
      
      setMessages(prev => [...prev, { id: makeId('msg'), role: 'agent', text: action.reply_text }]);

      // Executar a ação no CRM, se houver
      if (action.type !== 'none' && action.payload) {
        updateData(current => {
          const newData = { ...current };
          const now = new Date().toISOString();

          switch (action.type) {
            case 'create_client':
              const newClient: Client = {
                id: makeId('cli'),
                projectId: '',
                name: action.payload.name || 'Novo Cliente',
                company: action.payload.company || action.payload.name || 'Empresa',
                segment: action.payload.segment || 'Geral',
                structure: 'Geral',
                hasProject: false,
                contact: action.payload.contact || '',
                monthlyFee: action.payload.fee || 0,
                managementFeeType: 'recurring',
                dueDay: 5,
                adInvestmentPeriod: 'monthly',
                adInvestmentMeta: 0,
                adInvestmentGoogle: 0,
                adInvestmentYoutube: 0,
                adInvestmentTikTok: 0,
                status: 'lead',
                notes: action.payload.description || '',
                createdAt: now,
                updatedAt: now,
                lastActivityAt: now,
              };
              newData.clients = [newClient, ...newData.clients];
              break;

            case 'create_campaign':
              const newCampaign: Campaign = {
                id: makeId('camp'),
                name: action.payload.name || 'Nova Campanha',
                clientId: action.payload.clientId || '',
                platform: action.payload.platform || 'Outro',
                objective: action.payload.objective || 'Tráfego',
                status: 'setup',
                budget: action.payload.budget || 0,
                spent: 0,
                priority: action.payload.priority || 'medium',
                lastOptimizedAt: '',
                nextAction: 'Configurar anúncio inicial',
                createdAt: now,
                updatedAt: now,
                lastActivityAt: now,
              };
              newData.campaigns = [newCampaign, ...newData.campaigns];
              break;
              
            case 'create_task':
              const newTask: Task = {
                id: makeId('task'),
                title: action.payload.title || 'Nova Tarefa',
                dueDate: action.payload.dueDate || now.slice(0,10),
                area: action.payload.area || 'geral',
                taskType: action.payload.taskType || 'otimizacao',
                clientId: action.payload.clientId || undefined,
                done: false,
                hasFinance: false,
              };
              newData.tasks = [newTask, ...newData.tasks];
              break;
              
            case 'create_project':
              const newProject: Project = {
                id: makeId('proj'),
                projectType: action.payload.type || 'site',
                clientId: action.payload.clientId || '',
                ownerName: 'Cliente',
                company: 'Empresa',
                billingType: 'one_time',
                name: action.payload.name || 'Novo Projeto',
                role: 'Desenvolvimento',
                status: 'planning',
                progress: 0,
                dueDate: action.payload.dueDate || now.slice(0,10),
                amountCharged: action.payload.value || 0,
                amountReceived: 0,
                paymentStatus: 'pending',
                deliveredUrl: '',
                visibility: 'private',
                nextAction: 'Reunião de kickoff',
                createdAt: now,
                updatedAt: now,
                lastActivityAt: now,
              };
              newData.projects = [newProject, ...newData.projects];
              break;
          }
          
          return newData;
        });
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: makeId('msg'), role: 'agent', text: 'Ops, ocorreu um erro ao processar seu comando.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="flex h-full flex-col bg-brand-ink">
      {/* HEADER */}
      <div className="flex items-center gap-3 border-b border-brand-line bg-brand-surface p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green/20 text-brand-green">
          <Bot size={24} />
        </div>
        <div>
          <h1 className="text-lg font-black text-white">Assistente de IA</h1>
          <p className="text-xs text-brand-muted">Comandos por voz e texto integrados ao Claude</p>
        </div>
      </div>

      {/* MESSAGES */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${msg.role === 'user' ? 'bg-brand-surface border border-brand-line' : 'bg-brand-green text-brand-ink'}`}>
              {msg.role === 'user' ? <User size={16} className="text-brand-muted" /> : <Bot size={16} />}
            </div>
            <div className={`max-w-[75%] rounded-2xl p-4 ${msg.role === 'user' ? 'bg-brand-surface border border-brand-line text-white' : 'bg-brand-surface2 text-brand-soft border border-brand-line/50'}`}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green text-brand-ink">
              <Bot size={16} />
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-brand-surface2 p-4 border border-brand-line/50">
              <Loader2 size={16} className="animate-spin text-brand-green" />
              <span className="text-sm text-brand-soft">Processando comando...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* INPUT AREA */}
      <div className="border-t border-brand-line bg-brand-surface p-4">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-4xl items-center gap-2 relative">
          <button
            type="button"
            onClick={toggleListen}
            className={`absolute left-2 flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${isListening ? 'bg-red-500/20 text-red-500 animate-pulse' : 'text-brand-muted hover:bg-brand-surface2 hover:text-white'}`}
            title={isListening ? 'Parar gravação' : 'Falar comando'}
          >
            {isListening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isListening ? "Ouvindo..." : "Ex: Crie uma nova campanha pro cliente Vertex com 1000 reais de verba"}
            className="w-full rounded-xl border border-brand-line bg-brand-ink py-4 pl-14 pr-14 text-white outline-none focus:border-brand-green"
          />
          
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green text-brand-ink disabled:opacity-50 transition-transform hover:scale-105 active:scale-95"
          >
            <Send size={18} className="ml-1" />
          </button>
        </form>
        <p className="text-center text-[10px] text-brand-muted mt-2">
          O assistente pode criar campanhas, projetos, clientes e tarefas. Use áudio ou digite.
        </p>
      </div>
    </section>
  );
}
