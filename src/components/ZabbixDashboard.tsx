import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Database, 
  Cpu, 
  MemoryStick as Memory, 
  HardDrive, 
  AlertTriangle, 
  RefreshCcw, 
  ShieldCheck,
  TrendingDown,
  Info,
  Trash2,
  X
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { getHealthAssessment } from '../services/geminiService';
import { ZabbixItem, ZabbixHost, FileServer } from '../types';

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6'];

export default function ZabbixDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hostInfo, setHostInfo] = useState<ZabbixHost | null>(null);
  const [items, setItems] = useState<ZabbixItem[]>([]);
  const [metrics, setMetrics] = useState<any>({
    cpu: 0,
    ram: 0,
    diskUsed: 0,
    diskFree: 0,
    dedup: 1.0,
    drives: []
  });
  const [aiInsight, setAiInsight] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [activeView, setActiveView] = useState<'geral' | 'server'>('geral');
  const [allServersMetrics, setAllServersMetrics] = useState<any[]>([]);

  // Server Management State
  const [servers, setServers] = useState<FileServer[]>(() => {
    const saved = localStorage.getItem('zabbix_servers');
    return saved ? JSON.parse(saved) : [];
  });
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', hostname: '', desc: '' });

  const activeServer = servers.find(s => s.id === activeServerId) || null;

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setConfig(data);
      return data;
    } catch (err) {
      console.error(err);
    }
  };

  const fetchData = async () => {
    if (!activeServerId && servers.length > 0) {
      setActiveServerId(servers[0].id);
      return;
    }
    
    if (activeView === 'geral') {
      await fetchAllServersData();
      setLoading(false);
      return;
    }

    if (!activeServer) {
      setLoading(false);
      return;
    }

    setIsRefreshing(true);
    try {
      const configData = await fetchConfig();
      if (!configData?.hasZabbixUrl || !configData?.hasZabbixToken) {
        setError("Configure as variáveis de ambiente (ZABBIX_URL, ZABBIX_API_TOKEN) nos Secrets.");
        setLoading(false);
        return;
      }

      const hostName = activeServer?.zabbixHostname || configData.hostName;

      const apiFetch = async (method: string, params: any) => {
        const resp = await fetch('/api/zabbix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, params })
        });
        const data = await resp.json();
        if (!resp.ok) {
          const errMsg = data.cause || data.error || "Erro de conexão";
          const details = data.details || data.targetUrl || "";
          
          if (errMsg.includes("ENOTFOUND") || errMsg.includes("ECONNREFUSED")) {
             const error = new Error("NETWORK_LIMITATION");
             (error as any).details = details;
             throw error;
          }
          const error = new Error(errMsg);
          (error as any).details = details;
          throw error;
        }
        return data;
      };

      // 1. Get Host ID
      const hostData = await apiFetch('host.get', { 
        search: { host: [hostName] }, // Use search instead of filter for more flexibility
        output: ['hostid', 'host', 'name'] 
      });
      
      const hostFound = (hostData.result || []).find((h: any) => 
        h.host.toLowerCase() === hostName.toLowerCase() || 
        h.name.toLowerCase() === hostName.toLowerCase()
      );
      
      if (!hostFound) {
        throw new Error(`Servidor "${hostName}" não encontrado no Zabbix.`);
      }

      const host = hostFound;
      setHostInfo(host);

      // 2. Get All Items for this Host
      const itemsData = await apiFetch('item.get', { 
        hostids: host.hostid, 
        output: ['itemid', 'name', 'lastvalue', 'units', 'key_', 'value_type'],
        // Fetch more items to ensure we don't miss any due to key naming variations
        selectValueMap: 'extend',
      });
      
      const fetchedItems = itemsData.result || [];
      // Filter items manually to avoid Zabbix API 'search' limitations
      const filteredItems = fetchedItems.filter((i: ZabbixItem) => {
        const k = i.key_.toLowerCase();
        const n = i.name.toLowerCase();
        return k.includes('fs.size') || k.includes('c.fs') || k.includes('vfs.fs') || 
               k.includes('cpu') || k.includes('memory') || 
               n.includes('disk') || n.includes('storage') || n.includes('cpu') || n.includes('memory');
      });

      setItems(filteredItems);
      processMetrics(filteredItems);
      setError(null);
    } catch (err: any) {
      console.error(err);
      // Detailed error for debugging
      const detailMsg = err.details ? ` (${err.details})` : '';
      const finalError = `${err.message}${detailMsg}`;
      
      if (err.message === "NETWORK_LIMITATION" || finalError.includes("ENOTFOUND") || finalError.includes("ECONNREFUSED")) {
        setError("NETWORK_INTERNAL");
        loadDemoData();
      } else {
        setError(finalError || "Erro ao buscar dados do Zabbix.");
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleAddServer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServer.name || !newServer.hostname) return;
    
    const server: FileServer = {
      id: Date.now().toString(),
      name: newServer.name,
      zabbixHostname: newServer.hostname,
      description: newServer.desc
    };
    
    setServers([...servers, server]);
    setNewServer({ name: '', hostname: '', desc: '' });
    setIsAddingServer(false);
    setActiveServerId(server.id);
  };

  const handleDeleteServer = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (servers.length <= 1) {
      // Prevent deleting last server if you want, but user asked to delete even demo
      // We can just keep an empty list or show a message
    }
    const updated = servers.filter(s => s.id !== id);
    setServers(updated);
    if (activeServerId === id && updated.length > 0) {
      setActiveServerId(updated[0].id);
    } else if (updated.length === 0) {
      setActiveServerId(null);
    }
  };

  useEffect(() => {
    localStorage.setItem('zabbix_servers', JSON.stringify(servers));
  }, [servers]);

  const fetchAllServersData = async () => {
    setIsRefreshing(true);
    try {
      const results = [];
      for (const server of servers) {
        try {
          const apiFetch = async (method: string, params: any) => {
            const resp = await fetch('/api/zabbix', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ method, params })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);
            return data;
          };

          const hostData = await apiFetch('host.get', { 
            search: { host: [server.zabbixHostname] },
            output: ['hostid', 'host', 'name'] 
          });
          
          const host = (hostData.result || []).find((h: any) => 
            h.host.toLowerCase() === server.zabbixHostname.toLowerCase() || 
            h.name.toLowerCase() === server.zabbixHostname.toLowerCase()
          );

          if (host) {
            const itemsData = await apiFetch('item.get', { hostids: host.hostid, output: ['name', 'lastvalue', 'units', 'key_'] });
            const fetched = itemsData.result || [];
            const result = processMetrics(fetched, false);
            results.push({ server, metrics: result, online: true });
          } else {
            results.push({ server, online: false, error: 'Não encontrado' });
          }
        } catch (e) {
          results.push({ server, online: false, error: 'Erro de conexão' });
        }
      }
      setAllServersMetrics(results);
    } catch (err) {
      console.error(err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const processMetrics = (fetchedItems: ZabbixItem[], updateState = true) => {
    // Utility to find specific drive letters or file systems
    const getDiskDrives = () => {
      const drives: any[] = [];
      const labels = new Set<string>();
      
      // 1. Discovery: Look for anything that looks like a mount point or drive letter
      fetchedItems.forEach(i => {
        const k = i.key_.toLowerCase();
        // Match bracketed labels like [C:,...] or [C:] or [/]
        const match = i.key_.match(/\[(.*?)(?:,.*?)?\]/);
        if (match && match[1]) {
          const l = match[1].trim();
          // Exclude generic 'total' or empty labels
          if (l && l.toLowerCase() !== 'total' && (l.includes(':') || l.includes('/') || l.length <= 3)) {
            labels.add(l);
          }
        }
        // Fallback for names: looks for C: or D: in item name
        const nameMatch = i.name.match(/([a-zA-Z]:)/);
        if (nameMatch) labels.add(nameMatch[1]);
      });

      // 2. Data Extraction for each discovered label
      Array.from(labels).forEach(label => {
        const lowerLabel = label.toLowerCase();
        
        const findMetric = (parts: string[], exclude: string[] = []) => {
          const lowerParts = parts.map(p => p.toLowerCase());
          const lowerExclude = exclude.map(p => p.toLowerCase());
          return fetchedItems.find(i => {
            const lowerK = i.key_.toLowerCase();
            const lowerN = i.name.toLowerCase();
            const matchesLabel = lowerK.includes(lowerLabel) || lowerN.includes(lowerLabel);
            const matchesParts = lowerParts.every(p => lowerK.includes(p) || lowerN.includes(p));
            const matchesExclude = lowerExclude.some(e => lowerK.includes(e) || lowerN.includes(e));
            return matchesLabel && matchesParts && !matchesExclude;
          });
        };
        
        const totalItem = findMetric(['total'], ['pfree', 'pused']) || findMetric(['size'], ['pfree', 'pused']);
        const usedItem = findMetric(['used'], ['pused']) || findMetric(['used_space']);
        const freeItem = findMetric(['free'], ['pfree']) || findMetric(['available']);
        const pusedItem = findMetric(['pused']) || findMetric(['percentage', 'used']);
        
        const total = totalItem ? parseFloat(totalItem.lastvalue) : 0;
        const used = usedItem ? parseFloat(usedItem.lastvalue) : 0;
        const free = freeItem ? parseFloat(freeItem.lastvalue) : (total > 0 && used > 0 ? total - used : 0);
        
        let percent = 0;
        if (pusedItem) {
          percent = Math.round(parseFloat(pusedItem.lastvalue));
        } else if (total > 0) {
          percent = Math.round((used / total) * 100);
        } else if (total === 0 && used > 0 && free > 0) {
          percent = Math.round((used / (used + free)) * 100);
        }

        // Only add if we represent a real drive with some usage/size info
        if (percent > 0 || total > 0 || free > 0 || used > 0) {
          drives.push({ 
            label, 
            total: total || (used + free), 
            used: used || (total * (percent/100)), 
            free: free || (total * (1 - percent/100)), 
            percent 
          });
        }
      });

      // deduplicate by label (case-insensitive)
      const uniqueDrives: any[] = [];
      const seen = new Set();
      drives.forEach(d => {
        const l = d.label.toUpperCase();
        if (!seen.has(l)) {
          seen.add(l);
          uniqueDrives.push(d);
        }
      });

      return uniqueDrives.sort((a, b) => a.label.localeCompare(b.label));
    };

    const findValue = (regex: RegExp) => {
      const item = fetchedItems.find((i: ZabbixItem) => regex.test(i.key_) || regex.test(i.name.toLowerCase()));
      return item ? parseFloat(item.lastvalue) : 0;
    };

    // CPU Logic
    const cpuUtil = findValue(/system.cpu.util/) || (findValue(/system.cpu.load/) * 10) || findValue(/cpu utilization/); 
    
    // Memory Logic: Support multiple key formats
    const memTotal = findValue(/vm.memory.size\[total\]/) || findValue(/total memory/) || findValue(/mem.total/);
    const memAvailable = findValue(/vm.memory.size\[available\]/) || findValue(/vm.memory.size\[free\]/) || findValue(/available memory/) || findValue(/free physical memory/);
    const ramPercent = memTotal > 0 ? Math.round(((memTotal - (memAvailable || 0)) / memTotal) * 100) : 0;
    
    const drives = getDiskDrives();
    const mainDrive = drives.find(d => d.label.toUpperCase() === 'C:') || drives[0] || { percent: 0, free: 0 };

    const currentMetrics = {
      cpu: Math.min(Math.round(cpuUtil || 0), 100),
      ram: Math.round(ramPercent || 0),
      diskUsed: Math.round(mainDrive.percent || 0),
      diskFree: Math.round(((mainDrive.free || 0) / 1024 / 1024 / 1024) * 10) / 10,
      drives: drives || []
    };

    if (updateState) {
      setMetrics(currentMetrics);
      fetchAiInsight(currentMetrics);
    }
    return currentMetrics;
  };

  const searchDedup = (items: ZabbixItem[]) => {
    const item = items.find(i => /dedup/i.test(i.name) || /dedup/i.test(i.key_));
    return item ? parseFloat(item.lastvalue) : null;
  };

  const loadDemoData = () => {
    setHostInfo({ 
      hostid: "999", 
      host: activeServer?.zabbixHostname || "DEMO-SERVER", 
      name: activeServer?.name || "Servidor Demo" 
    });
    const demoMetrics = {
      cpu: Math.round(28.5 + (Math.random() * 10)),
      ram: Math.round(64.2 + (Math.random() * 5)),
      diskUsed: 78.4,
      diskFree: 412,
      dedup: 1.8
    };
    setMetrics(demoMetrics);
    fetchAiInsight(demoMetrics);
  };

  const fetchAiInsight = async (m: any) => {
    const assessment = await getHealthAssessment(m);
    setAiInsight(assessment);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [activeServerId, activeView]);

  if (loading && servers.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-950 text-slate-200">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="mb-4"
        >
          <RefreshCcw className="w-10 h-10 text-emerald-500 shadow-[0_0_8px_#10b981]" />
        </motion.div>
        <p className="text-slate-500 font-mono tracking-widest uppercase text-[10px]">Sincronizando com Zabbix...</p>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-950 text-white p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-8 text-center shadow-2xl">
          <Database className="w-16 h-16 text-emerald-500 mx-auto mb-6 opacity-50" />
          <h2 className="text-2xl font-bold mb-4">Nenhum Servidor Ativo</h2>
          <p className="text-slate-400 text-sm mb-8 leading-relaxed">
            Bem-vindo ao Dashboard. Comece adicionando o host que você deseja monitorar no Zabbix.
          </p>
          <button 
            onClick={() => setIsAddingServer(true)}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
          >
            <Database className="w-5 h-5" />
            Adicionar Primeiro Servidor
          </button>
          
          <AnimatePresence>
            {isAddingServer && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
              >
                <form onSubmit={handleAddServer} className="bg-slate-900 border border-slate-800 p-8 rounded-xl w-full max-w-md shadow-2xl text-left">
                  <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <Database className="w-5 h-5 text-emerald-500" /> Cadastrar Servidor
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Nome de Exibição</label>
                      <input type="text" required className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" placeholder="Ex: Servidor de Arquivos" value={newServer.name} onChange={e => setNewServer({...newServer, name: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Hostname no Zabbix</label>
                      <input type="text" required className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" placeholder="Ex: FS-RH-01" value={newServer.hostname} onChange={e => setNewServer({...newServer, hostname: e.target.value})} />
                    </div>
                  </div>
                  <div className="flex gap-3 mt-8">
                    <button type="button" onClick={() => setIsAddingServer(false)} className="flex-1 py-3 border border-slate-800 hover:bg-slate-800 rounded text-sm font-bold">Cancelar</button>
                    <button type="submit" className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-bold">Salvar</button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (servers.length > 0 && !activeServer) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-500">
        <RefreshCcw className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error && error !== 'NETWORK_INTERNAL') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-950 text-white p-6">
        <div className="max-w-md w-full bg-slate-900 border border-rose-500/30 rounded-lg p-8 text-center ring-1 ring-rose-500/20">
          <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">Erro de Configuração</h2>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <button 
            onClick={fetchData}
            className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-2 rounded transition-all flex items-center justify-center gap-2 text-sm"
          >
            <RefreshCcw className="w-4 h-4" />
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full p-4 gap-4 bg-slate-950 text-slate-200">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border border-slate-800 rounded-lg flex flex-col p-4 shadow-xl overflow-y-auto custom-scrollbar">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></div>
          <h1 className="font-bold text-lg tracking-tight">Zabbix <span className="text-slate-500">Storage</span></h1>
        </div>

        <nav className="space-y-4 flex-1">
          <div>
            <button 
              onClick={() => { setActiveView('geral'); setHostInfo(null); }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md transition-all mb-4 ${
                activeView === 'geral' 
                ? 'bg-emerald-600/10 text-emerald-400 border border-emerald-600/20' 
                : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span className="text-sm font-medium">Geral</span>
            </button>

            <div className="flex items-center justify-between mb-2 px-2">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Servidores</span>
              <button 
                onClick={() => setIsAddingServer(true)}
                className="p-1 hover:bg-slate-800 rounded text-emerald-500 transition-colors"
                title="Adicionar Servidor"
              >
                <Database className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-1">
              {servers.map(server => (
                <div key={server.id} className="group relative">
                  <button 
                    onClick={() => { setActiveServerId(server.id); setActiveView('server'); }}
                    className={`w-full text-left px-3 py-2 rounded-md transition-all pr-8 ${
                      activeView === 'server' && activeServerId === server.id 
                      ? 'bg-blue-600/10 text-blue-400 border border-blue-600/20' 
                      : 'text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-sm font-medium truncate">{server.name}</div>
                    <div className="text-[9px] opacity-60 font-mono">{server.zabbixHostname}</div>
                  </button>
                  <button 
                    onClick={(e) => handleDeleteServer(server.id, e)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                    title="Excluir Servidor"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {servers.length === 0 && (
                <div className="text-center py-4 px-2 border border-dashed border-slate-800 rounded bg-slate-950/50">
                  <p className="text-[10px] text-slate-600 uppercase">Nenhum servidor cadastrado</p>
                </div>
              )}
            </div>
          </div>
        </nav>

        {error === 'NETWORK_INTERNAL' && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] text-amber-200">
            <div className="flex items-center gap-1.5 font-bold mb-1 uppercase tracking-tighter">
              <AlertTriangle className="w-3 h-3 text-amber-500" /> Falha de Conexão
            </div>
            Não foi possível alcançar o Zabbix a partir deste servidor. Exibindo dados de simulação (Demo).
          </div>
        )}

        <div className="mt-auto p-3 bg-slate-950 border border-slate-800 rounded text-[10px]">
          <div className="text-slate-500 mb-1 flex justify-between">
            <span>Zabbix Token</span>
            <span className="text-emerald-500">Active</span>
          </div>
          <div className="font-mono text-slate-400 truncate">Token: {config?.hasZabbixToken ? '••••••••' : 'None'}</div>
          <button 
            onClick={fetchData}
            disabled={isRefreshing}
            className="w-full mt-3 flex items-center justify-center gap-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded transition-colors"
          >
            <RefreshCcw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Poll Now'}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col gap-4 overflow-hidden relative">
        {activeView === 'geral' ? (
          <div className="flex-1 flex flex-col gap-6 overflow-y-auto custom-scrollbar p-2">
            <header className="flex flex-col gap-1">
              <span className="text-[12px] uppercase tracking-[0.2em] text-slate-500 font-black">Monitoramento / Global</span>
              <h1 className="text-4xl font-black text-white tracking-tighter uppercase">Painel Geral de Armazenamento</h1>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {allServersMetrics.map(({ server, metrics, online, error }) => (
                <motion.div 
                  key={server.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl relative overflow-hidden group hover:border-emerald-500/50 transition-all cursor-pointer ring-1 ring-white/5 hover:ring-emerald-500/30"
                  onClick={() => { setActiveServerId(server.id); setActiveView('server'); }}
                >
                  <div className="flex items-center justify-between mb-4 relative z-10">
                    <div className="min-w-0">
                      <h3 className="text-lg font-black text-white uppercase tracking-tight group-hover:text-emerald-400 transition-colors truncate">{server.name}</h3>
                      <p className="text-[11px] text-slate-500 font-mono italic uppercase tracking-widest truncate">{server.zabbixHostname}</p>
                    </div>
                    <div className="flex gap-4 flex-shrink-0">
                      <div className="flex flex-col items-center">
                        <div className="text-[10px] uppercase text-slate-500 font-extrabold">CPU</div>
                        <div className={`text-[15px] font-black font-mono ${online && metrics.cpu > 80 ? 'text-rose-500' : 'text-emerald-400'}`}>
                          {online ? `${metrics.cpu}%` : '--'}
                        </div>
                      </div>
                      <div className="w-px h-6 bg-slate-800 my-auto"></div>
                      <div className="flex flex-col items-center">
                        <div className="text-[10px] uppercase text-slate-500 font-extrabold">RAM</div>
                        <div className={`text-[15px] font-black font-mono ${online && metrics.ram > 85 ? 'text-rose-500' : 'text-blue-400'}`}>
                          {online ? `${metrics.ram}%` : '--'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {!online ? (
                    <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded text-rose-400 text-xs font-black uppercase italic">
                      <AlertTriangle className="w-5 h-5" /> {error || 'OFFLINE'}
                    </div>
                  ) : (
                    <div className="space-y-4">
                       <span className="text-[11px] uppercase tracking-widest text-slate-600 font-black">Storage Units</span>
                      {metrics.drives && metrics.drives.slice(0, 3).map((drive: any) => (
                        <div key={drive.label} className="space-y-2">
                          <div className="flex justify-between text-[12px] items-end font-extrabold">
                            <span className="text-slate-200 uppercase tracking-wide">{drive.label}</span>
                            <span className={`font-mono text-sm font-black ${drive.percent > 85 ? 'text-rose-500 animate-pulse' : 'text-emerald-400'}`}>
                              {drive.percent}%
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-3.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-0.5 relative">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${drive.percent}%` }}
                                className={`h-full rounded-full ${
                                  drive.percent > 85 
                                  ? 'bg-gradient-to-r from-rose-600 to-rose-400 shadow-[0_0_15px_#ef444460]' 
                                  : 'bg-gradient-to-r from-emerald-500 to-emerald-300 shadow-[0_0_15px_#10b98130]'
                                }`}
                              />
                            </div>
                          </div>
                          
                          <div className="flex justify-between text-[11px] font-black font-mono uppercase tracking-tighter">
                            <span className="text-slate-400">Total - {Math.round(drive.total / 1024 / 1024 / 1024)}GB</span>
                            <span className="text-slate-200">{Math.round(drive.free / 1024 / 1024 / 1024)}GB LIVRE</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="absolute top-0 right-0 p-5 bg-white opacity-[0.01] rounded-bl-full pointer-events-none group-hover:opacity-[0.02] transition-all"></div>
                </motion.div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <AnimatePresence>
          {isAddingServer && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
            >
              <form onSubmit={handleAddServer} className="bg-slate-900 border border-slate-800 p-8 rounded-xl w-full max-w-md shadow-2xl">
                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                  <Database className="w-5 h-5 text-emerald-500" /> Cadastrar Servidor
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Nome de Exibição</label>
                    <input 
                      type="text" 
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                      placeholder="Ex: Produção-FS-01"
                      value={newServer.name}
                      onChange={e => setNewServer({...newServer, name: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Hostname no Zabbix</label>
                    <input 
                      type="text" 
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                      placeholder="Nome exato como está no Zabbix"
                      value={newServer.hostname}
                      onChange={e => setNewServer({...newServer, hostname: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Descrição</label>
                    <input 
                      type="text" 
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                      placeholder="Opcional"
                      value={newServer.desc}
                      onChange={e => setNewServer({...newServer, desc: e.target.value})}
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-8">
                  <button 
                    type="button"
                    onClick={() => setIsAddingServer(false)}
                    className="flex-1 py-3 border border-slate-800 hover:bg-slate-800 rounded text-sm font-bold transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-bold transition-all"
                  >
                    Salvar
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        <header className="flex justify-between items-end">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-sm uppercase tracking-wider font-bold">Monitoramento /</span>
              <span className="font-black text-sm uppercase tracking-wider text-emerald-400 truncate max-w-[300px]">
                {hostInfo?.host}
              </span>
            </div>
            <h2 className="text-3xl font-black tracking-tight text-white">{activeServer?.name}</h2>
            <p className="text-[12px] text-slate-500 font-mono italic font-bold">{activeServer?.description}</p>
          </div>
          
          <div className="flex gap-3">
            <div className={`px-4 py-1.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-full font-black shadow-sm ${metrics.diskUsed > 90 || metrics.cpu > 80 ? 'opacity-100' : 'opacity-0'}`}>
              CRITICAL ALERTS
            </div>
            <div className="px-4 py-1.5 bg-slate-800/50 border border-slate-700/50 text-slate-400 text-xs rounded-full font-black">
              NODE_ID: {hostInfo?.hostid}
            </div>
          </div>
        </header>

        <section className="grid grid-cols-3 gap-4">
          <MetricCard 
            title="CPU Load" 
            value={`${metrics.cpu}%`} 
            subtitle={metrics.cpu > 60 ? 'High workload detected' : 'Operational Load'}
            icon={<Cpu className="w-4 h-4 text-blue-400" />} 
            status={metrics.cpu > 80 ? 'critical' : metrics.cpu > 50 ? 'warning' : 'healthy'}
          />
          <MetricCard 
            title="Espaço Livre, C:" 
            value={`${metrics.diskFree} GB`} 
            subtitle="Available Capacity"
            icon={<HardDrive className="w-4 h-4 text-emerald-400" />} 
            status={metrics.diskUsed > 85 ? 'critical' : 'healthy'}
          />
          <MetricCard 
            title="Memory Status" 
            value={`${metrics.ram}%`} 
            subtitle="Current Allocation"
            icon={<Memory className="w-4 h-4 text-amber-400" />} 
            status={metrics.ram > 85 ? 'critical' : metrics.ram > 70 ? 'warning' : 'healthy'}
          />
        </section>

        <div className="grid grid-cols-3 flex-1 gap-4 overflow-hidden">
          <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col shadow-lg overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Database className="w-3 h-3" /> Disk Partition Breakdown
              </h3>
              <div className="flex gap-4 text-[10px] text-slate-500 font-mono">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-blue-500"></div> USED</div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-slate-800"></div> FREE</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-6 custom-scrollbar">
              {(metrics.drives || []).map((drive: any, idx: number) => (
                <PartitionRow 
                  key={idx} 
                  label={`Drive ${drive.label}`} 
                  used={drive.percent} 
                  freeText={`${Math.round(drive.free / 1024 / 1024 / 1024)} GB`} 
                  totalText={`${Math.round(drive.total / 1024 / 1024 / 1024)} GB`} 
                />
              ))}
              
              {(!metrics.drives || metrics.drives.length === 0) && (
                <div className="text-center py-10 text-slate-600 font-mono text-[10px]">
                  Buscando unidades (C:, D:, /)...
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 flex-none">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider flex items-center gap-1"><Activity className="w-3 h-3" /> Predictive Health</div>
                <span className="text-[9px] bg-blue-500/20 px-1.5 py-0.5 rounded text-blue-300 uppercase">AI-EXTRACT</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed italic">"{aiInsight}"</p>
            </div>

            <div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col shadow-inner">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6">Resource Monitors</h3>
              <div className="space-y-6 flex-1">
                <MiniLineMonitor label="CPU Consumption" value={metrics.cpu} status={metrics.cpu > 70 ? 'High' : 'Stable'} color={metrics.cpu > 70 ? 'rose' : 'emerald'} />
                <MiniLineMonitor label="Memory Load" value={metrics.ram} status="Optimized" color="blue" />
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between items-center text-[10px] text-slate-500 uppercase font-bold"><span>Cluster Sync</span><span className="text-emerald-500">100%</span></div>
                  <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 w-full"></div></div>
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-slate-800">
                <div className="flex items-center gap-2 text-slate-600"><Info className="w-3 h-3" /><span className="text-[9px] uppercase tracking-tighter">Zabbix v7.0.4-LTS Connected</span></div>
              </div>
            </div>
          </div>
        </div>
      </>
    )}
  </main>
</div>
  );
}


function MetricCard({ title, value, icon, status, subtitle }: any) {
  const statusGlow: any = {
    healthy: 'border-slate-800',
    warning: 'border-amber-500/40 shadow-[0_0_15px_-5px_#f59e0b20]',
    critical: 'border-rose-500/40 shadow-[0_0_15px_-5px_#ef444420]'
  };

  const textColors: any = {
    healthy: 'text-white',
    warning: 'text-amber-400',
    critical: 'text-rose-400'
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-slate-900 border ${statusGlow[status]} p-4 rounded-lg flex flex-col`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="text-xs text-slate-400 uppercase tracking-wider font-black">{title}</div>
        <div className="p-1 px-1.5 bg-slate-800 rounded">{icon}</div>
      </div>
      <div className={`text-3xl font-mono font-black leading-none ${textColors[status]}`}>{value}</div>
      <div className="text-[10px] text-slate-500 mt-2 font-mono uppercase tracking-tight font-bold">{subtitle}</div>
    </motion.div>
  );
}

function PartitionRow({ label, used, freeText, totalText }: any) {
  const isHigh = used > 85;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs font-extrabold uppercase">
        <span className="font-mono text-slate-200">{label}</span>
        <span className={isHigh ? "text-rose-400 animate-pulse" : "text-sky-400"}>{used}% Used</span>
      </div>
      <div className="h-3 w-full bg-slate-800 rounded-full flex overflow-hidden ring-1 ring-white/5 p-0.5">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${used}%` }}
          className={`h-full rounded-full transition-all ${isHigh ? 'bg-rose-500' : 'bg-emerald-500'}`} 
        />
      </div>
      <div className="flex justify-between text-[11px] text-slate-400 font-extrabold font-mono uppercase tracking-tighter">
        <span>Total: {totalText}</span>
        <span className={isHigh ? "text-rose-400/80" : ""}>{freeText} Free</span>
      </div>
    </div>
  );
}

function MiniLineMonitor({ label, value, status, color }: any) {
  const colorMap: any = {
    emerald: 'bg-emerald-500/40',
    blue: 'bg-blue-500/40',
    rose: 'bg-rose-500/40'
  };
  
  const textMap: any = {
    emerald: 'text-emerald-400',
    blue: 'text-blue-400',
    rose: 'text-rose-400'
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-tight">
        <span className="text-slate-400">{label}</span>
        <span className={`font-mono ${textMap[color]}`}>{status}</span>
      </div>
      <div className="h-10 bg-slate-950/80 border border-slate-800 flex items-end p-1 gap-1 rounded overflow-hidden">
        {/* Mocking recent history bars */}
        {[30, 25, 45, valToPercent(value), 32, 28, valToPercent(value)].map((h, i) => (
          <div 
            key={i} 
            className={`flex-1 ${colorMap[color]} rounded-t-sm`} 
            style={{ height: `${h}%` }} 
          />
        ))}
      </div>
    </div>
  );
}

function valToPercent(val: any) {
  return Math.min(Math.max(val, 10), 100);
}
