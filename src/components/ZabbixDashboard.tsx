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
  Edit2,
  X,
  Image as ImageIcon,
  Upload,
  FileText,
  CheckSquare,
  Square,
  Save,
  Plus,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ExternalLink
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
import { ZabbixItem, ZabbixHost, FileServer, ServerImage, ServerNoteItem } from '../types';

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6'];

// Função utilitária para comprimir imagens no navegador antes do upload
const compressImageFile = (fileToCompress: File, maxWidth = 1200, quality = 0.75): Promise<File> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(fileToCompress);
    reader.onload = (event: any) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(new File([blob], fileToCompress.name.replace(/\.[^/.]+$/, ".jpg"), { type: 'image/jpeg' }));
          } else {
            resolve(fileToCompress);
          }
        }, 'image/jpeg', quality);
      };
    };
  });
};

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
  const [servers, setServers] = useState<FileServer[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', hostname: '', desc: '' });
  const [isEditingServer, setIsEditingServer] = useState(false);
  const [editingServer, setEditingServer] = useState<FileServer | null>(null);
  const [editForm, setEditForm] = useState({ name: '', hostname: '', desc: '' });

  // Image Gallery & Notes State
  const [selectedFullImage, setSelectedFullImage] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState<number | 'fit'>('fit');

  const openImageModal = (url: string) => {
    setSelectedFullImage(url);
    setImageZoom('fit');
  };
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteTextDraft, setNoteTextDraft] = useState('');
  const [newCheckitemText, setNewCheckitemText] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | null>(null);

  useEffect(() => {
    if (!isEditingNote) {
      const server = servers.find(s => s.id === activeServerId);
      setNoteTextDraft(server?.noteText || '');
    }
  }, [activeServerId, isEditingNote, servers]);

  // Initial fetch from backend with fallback
  useEffect(() => {
    const initServers = async () => {
      console.log("Iniciando busca de servidores no backend...");
      setLoading(true);
      try {
        const res = await fetch('/api/servers');
        if (!res.ok) throw new Error("Erro ao buscar servidores");
        const data = await res.json();
        console.log("Servidores recuperados do database.json:", data);
        
        let loadedServers: FileServer[] = [];
        if (data && data.servers && Array.isArray(data.servers) && data.servers.length > 0) {
          loadedServers = data.servers;
        } else {
          // Fallback to localStorage if server database is empty
          const backup = localStorage.getItem('zabbix_servers_backup');
          if (backup) {
            try {
              const parsed = JSON.parse(backup);
              if (Array.isArray(parsed) && parsed.length > 0) {
                loadedServers = parsed;
                // Sync backup back to server database
                await fetch('/api/servers', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ servers: parsed })
                });
              }
            } catch (e) {}
          }
        }

        if (loadedServers.length > 0) {
          setServers(loadedServers);
          setActiveServerId(prev => prev || loadedServers[0].id);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error("Erro ao carregar servidores do backend:", err);
        const backup = localStorage.getItem('zabbix_servers_backup');
        if (backup) {
          try {
            const parsed = JSON.parse(backup);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setServers(parsed);
              setActiveServerId(prev => prev || parsed[0].id);
            }
          } catch(e) {}
        }
        setLoading(false);
      }
    };
    initServers();
  }, []);

  const saveServers = async (updatedServers: FileServer[]) => {
    setSaveStatus('saving');
    try {
      // Limpa do JSON qualquer string base64 residual para evitar estouro de payload (Erro 413)
      const sanitizedServers = updatedServers.map(server => ({
        ...server,
        images: (server.images || []).map(img => ({
          ...img,
          url: img.url.startsWith('data:image/') ? `/img/img_fallback_${img.id}.png` : img.url
        }))
      }));

      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: sanitizedServers })
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("Erro ao salvar servidores no servidor:", res.status, errText);
        setSaveStatus('error');
      } else {
        console.log("Servidores salvos com sucesso no servidor (database.json)!");
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(null), 3000);
      }
    } catch (err) {
      console.error("Falha de rede ao salvar servidores no backend", err);
      setSaveStatus('error');
    }

    try {
      localStorage.setItem('zabbix_servers_backup', JSON.stringify(updatedServers));
    } catch (e) {
      console.warn("Nao foi possivel salvar no localStorage backup", e);
    }
  };

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
          const errMsg = data.error || "Erro de conexão";
          const details = data.details || data.hint || "";
          
          if (errMsg === "DNS_NOT_FOUND" || errMsg === "CONNECTION_FAILED" || details.includes("ENOTFOUND")) {
             console.warn("Zabbix inacessível. Entrando em modo demonstração.");
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

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServer.name || !newServer.hostname) return;
    
    const server: FileServer = {
      id: Date.now().toString(),
      name: newServer.name,
      zabbixHostname: newServer.hostname,
      description: newServer.desc
    };
    
    const updatedServers = [...servers, server];
    setServers(updatedServers);
    await saveServers(updatedServers);
    setNewServer({ name: '', hostname: '', desc: '' });
    setIsAddingServer(false);
    setActiveServerId(server.id);
  };

  const handleStartEdit = (server: FileServer, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingServer(server);
    setEditForm({
      name: server.name,
      hostname: server.zabbixHostname,
      desc: server.description || ''
    });
    setIsEditingServer(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingServer) return;
    if (!editForm.name || !editForm.hostname) return;

    const updatedServers = servers.map(s => {
      if (s.id === editingServer.id) {
        return {
          ...s,
          name: editForm.name,
          zabbixHostname: editForm.hostname,
          description: editForm.desc
        };
      }
      return s;
    });

    setServers(updatedServers);
    await saveServers(updatedServers);
    setIsEditingServer(false);
    setEditingServer(null);
    
    if (activeServerId === editingServer.id) {
      fetchData();
    }
  };

  const handleDeleteServer = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = servers.filter(s => s.id !== id);
    setServers(updated);
    await saveServers(updated);
    if (activeServerId === id && updated.length > 0) {
      setActiveServerId(updated[0].id);
    } else if (updated.length === 0) {
      setActiveServerId(null);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeServerId) return;

    setSaveStatus('saving');

    try {
      // 1. Reduz e otimiza a imagem localmente usando o Canvas caso passe de 500KB
      const fileToUpload = file.size > 500 * 1024 ? await compressImageFile(file) : file;

      // 2. Prepara o envio binário leve via FormData nativo (Elimina o fluxo Base64 problemático)
      const formData = new FormData();
      formData.append('image', fileToUpload);
      formData.append('serverId', activeServerId);

      const uploadRes = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData
      });

      if (!uploadRes.ok) {
        throw new Error(`Servidor recusou o payload com status: ${uploadRes.status}`);
      }

      const uploadData = await uploadRes.json();

      if (uploadData.success && uploadData.url) {
        const finalUrl = uploadData.url;
        
        // Atualiza o estado dos servidores injetando a URL estática retornada pelo Express
        const updatedFinal = servers.map(s => {
          if (s.id === activeServerId) {
            return {
              ...s,
              images: [...(s.images || []), { id: Date.now().toString(), url: finalUrl }]
            };
          }
          return s;
        });

        setServers(updatedFinal);
        localStorage.setItem('zabbix_servers_backup', JSON.stringify(updatedFinal));
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error("Erro ao processar upload da imagem técnica:", err);
      setSaveStatus('error');
    }

    e.target.value = '';
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!activeServerId) return;
    const targetServer = servers.find(s => s.id === activeServerId);
    const targetImage = targetServer?.images?.find(i => i.id === imageId);

    setSaveStatus('saving');
    try {
      const res = await fetch('/api/delete-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetImage?.url || '',
          serverId: activeServerId,
          imageId
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.servers && Array.isArray(data.servers) && data.servers.length > 0) {
          setServers(data.servers);
        } else {
          const updated = servers.map(s => {
            if (s.id === activeServerId) {
              return {
                ...s,
                images: (s.images || []).filter(img => img.id !== imageId)
              };
            }
            return s;
          });
          setServers(updated);
          await saveServers(updated);
        }
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error("Erro ao deletar imagem:", err);
      setSaveStatus('error');
    }
  };

  const handleSaveNoteText = async () => {
    if (!activeServerId) return;
    const updated = servers.map(s => {
      if (s.id === activeServerId) {
        return {
          ...s,
          noteText: noteTextDraft
        };
      }
      return s;
    });
    setServers(updated);
    await saveServers(updated);
    setIsEditingNote(false);
  };

  const handleAddChecklistItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCheckitemText.trim() || !activeServerId) return;

    const newItem: ServerNoteItem = {
      id: Date.now().toString(),
      text: newCheckitemText.trim(),
      completed: false
    };

    const updated = servers.map(s => {
      if (s.id === activeServerId) {
        return {
          ...s,
          noteText: noteTextDraft,
          notes: [...(s.notes || []), newItem]
        };
      }
      return s;
    });
    setServers(updated);
    await saveServers(updated);
    setNewCheckitemText('');
  };

  const handleToggleChecklistItem = async (itemId: string) => {
    if (!activeServerId) return;
    const updated = servers.map(s => {
      if (s.id === activeServerId) {
        const updatedNotes = (s.notes || []).map(item => {
          if (item.id === itemId) {
            return { ...item, completed: !item.completed };
          }
          return item;
        });
        return { ...s, notes: updatedNotes };
      }
      return s;
    });
    setServers(updated);
    await saveServers(updated);
  };

  const handleDeleteChecklistItem = async (itemId: string) => {
    if (!activeServerId) return;
    const updated = servers.map(s => {
      if (s.id === activeServerId) {
        return {
          ...s,
          notes: (s.notes || []).filter(item => item.id !== itemId)
        };
      }
      return s;
    });
    setServers(updated);
    await saveServers(updated);
  };


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
      <aside className="w-72 bg-slate-900 border border-slate-800 rounded-lg flex flex-col p-5 shadow-xl overflow-y-auto custom-scrollbar">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-4 h-4 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
          <h1 className="font-black text-xl tracking-tighter">ZABBIX <span className="text-slate-500 font-medium">STORAGE</span></h1>
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
              <span className="text-xs uppercase tracking-widest text-slate-500 font-black">Servidores</span>
              <button 
                onClick={() => setIsAddingServer(true)}
                className="p-1 hover:bg-slate-800 rounded text-emerald-500 transition-colors"
                title="Adicionar Servidor"
              >
                <Database className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              {servers.map(server => (
                <div key={server.id} className="group relative">
                  <button 
                    onClick={() => { setActiveServerId(server.id); setActiveView('server'); }}
                    className={`w-full text-left px-3 py-2.5 rounded-md transition-all pr-14 ${
                      activeView === 'server' && activeServerId === server.id 
                      ? 'bg-blue-600/10 text-blue-400 border border-blue-600/20' 
                      : 'text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-[13px] font-black uppercase truncate pr-2">{server.zabbixHostname}</div>
                    <div className="text-[10px] opacity-60 font-mono font-bold truncate pr-2">{server.name}</div>
                  </button>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button 
                      onClick={(e) => handleStartEdit(server, e)}
                      className="p-1 text-slate-600 hover:text-amber-500 transition-all"
                      title="Editar Servidor"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button 
                      onClick={(e) => handleDeleteServer(server.id, e)}
                      className="p-1 text-slate-600 hover:text-rose-500 transition-all"
                      title="Excluir Servidor"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
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

        <div className="mt-auto p-4 bg-slate-950 border border-slate-800 rounded text-xs font-black">
          <div className="text-slate-500 mb-2 flex justify-between uppercase">
            <span>Zabbix Token</span>
            <span className="text-emerald-500">Active</span>
          </div>
          <div className="font-mono text-slate-400 truncate opacity-70">Token: {config?.hasZabbixToken ? '••••••••' : 'None'}</div>
          <button 
            onClick={fetchData}
            disabled={isRefreshing}
            className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
          >
            <RefreshCcw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Atualizando...' : 'Poll Now'}
          </button>
        </div>
      </aside>

      {/* Add Server Modal - Global */}
      <AnimatePresence>
        {isAddingServer && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
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

      {/* Edit Server Modal - Global */}
      <AnimatePresence>
        {isEditingServer && editingServer && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          >
            <form onSubmit={handleSaveEdit} className="bg-slate-900 border border-slate-800 p-8 rounded-xl w-full max-w-md shadow-2xl">
              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-amber-500" /> Editar Servidor
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Nome de Exibição</label>
                  <input 
                    type="text" 
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500 transition-colors"
                    placeholder="Ex: Produção-FS-01"
                    value={editForm.name}
                    onChange={e => setEditForm({...editForm, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Hostname no Zabbix</label>
                  <input 
                    type="text" 
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500 transition-colors"
                    placeholder="Nome exato como está no Zabbix"
                    value={editForm.hostname}
                    onChange={e => setEditForm({...editForm, hostname: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Descrição</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500 transition-colors"
                    placeholder="Opcional"
                    value={editForm.desc}
                    onChange={e => setEditForm({...editForm, desc: e.target.value})}
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button 
                  type="button"
                  onClick={() => {
                    setIsEditingServer(false);
                    setEditingServer(null);
                  }}
                  className="flex-1 py-3 border border-slate-800 hover:bg-slate-800 rounded text-sm font-bold transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 rounded text-sm font-bold transition-all text-white"
                >
                  Salvar
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col gap-4 overflow-hidden relative">
        {activeView === 'geral' ? (
          <div className="flex-1 flex flex-col gap-6 overflow-y-auto custom-scrollbar p-2">
            <header className="flex flex-col gap-1">
              <span className="text-[12px] uppercase tracking-[0.2em] text-slate-500 font-black">Monitoramento / Global</span>
              <h1 className="text-4xl font-black text-white tracking-tighter uppercase">Painel Geral de Armazenamento</h1>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {allServersMetrics.map(({ server, metrics, online, error }) => (
                <motion.div 
                  key={server.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-2xl relative overflow-hidden group hover:border-emerald-500/50 transition-all cursor-pointer ring-1 ring-white/5 hover:ring-emerald-500/30"
                  onClick={() => { setActiveServerId(server.id); setActiveView('server'); }}
                >
                  <div className="flex items-center justify-between mb-3 relative z-10">
                    <div className="min-w-0">
                      <h3 className="text-lg font-black text-white uppercase tracking-tight group-hover:text-emerald-400 transition-colors truncate">{server.zabbixHostname}</h3>
                      <p className="text-xs text-slate-300 font-mono italic uppercase tracking-widest truncate">{server.name}</p>
                    </div>
                    <div className="flex gap-4 flex-shrink-0">
                      <div className="flex flex-col items-center">
                        <div className="text-[11px] uppercase text-slate-400 font-black">CPU</div>
                        <div className={`text-base font-black font-mono ${online && metrics.cpu > 80 ? 'text-rose-500' : 'text-emerald-400'}`}>
                          {online ? `${metrics.cpu}%` : '--'}
                        </div>
                      </div>
                      <div className="w-0.5 h-6 bg-slate-700 my-auto"></div>
                      <div className="flex flex-col items-center">
                        <div className="text-[11px] uppercase text-slate-400 font-black">RAM</div>
                        <div className={`text-base font-black font-mono ${online && metrics.ram > 85 ? 'text-rose-500' : 'text-blue-400'}`}>
                          {online ? `${metrics.ram}%` : '--'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {!online ? (
                    <div className="flex items-center gap-2 p-2 bg-rose-500/10 border border-rose-500/20 rounded text-rose-400 text-xs font-black uppercase italic">
                      <AlertTriangle className="w-5 h-5" /> {error || 'OFFLINE'}
                    </div>
                  ) : (
                    <div className="space-y-3">
                       <span className="text-[11px] uppercase tracking-widest text-slate-500 font-black">Storage Units</span>
                      {metrics.drives && metrics.drives.slice(0, 3).map((drive: any) => (
                        <div key={drive.label} className="space-y-1.5">
                          <div className="flex justify-between text-[11px] items-end font-black">
                            <span className="text-slate-100 uppercase tracking-wide">{drive.label}</span>
                            <span className={`font-mono text-sm font-black ${drive.percent > 85 ? 'text-rose-500 animate-pulse' : 'text-emerald-300'}`}>
                              {drive.percent}%
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-3.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-1 relative">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${drive.percent}%` }}
                                className={`h-full rounded-full ${
                                  drive.percent > 85 
                                  ? 'bg-gradient-to-r from-rose-600 to-rose-400 shadow-[0_0_20px_#ef444480]' 
                                  : 'bg-gradient-to-r from-emerald-500 to-emerald-300 shadow-[0_0_20px_#10b98160]'
                                }`}
                              />
                            </div>
                          </div>
                          
                          <div className="flex justify-between text-[11px] font-black font-mono uppercase tracking-tighter">
                            <span className="text-slate-300">Total: {Math.round(drive.total / 1024 / 1024 / 1024)}GB</span>
                            <span className="text-white">Free: {Math.round(drive.free / 1024 / 1024 / 1024)}GB</span>
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
          <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col shadow-lg overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Database className="w-4 h-4" /> Disk Partition Breakdown
              </h3>
              <div className="flex gap-4 text-xs text-slate-500 font-mono font-black">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-blue-500 shadow-[0_0_10px_#3b82f640]"></div> USED</div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-slate-800"></div> FREE</div>
              </div>
            </div>

            <div className="space-y-3 pr-2 mb-3">
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
                <div className="text-center py-4 text-slate-600 font-mono text-[10px]">
                  Buscando unidades (C:, D:, /)...
                </div>
              )}
            </div>

            {/* Quadros Proporcionais Integrados ao Card */}
            <div className="mt-1 pt-3 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Quadro 1: Galeria de Imagens com Upload e Deleção (Compacto - 1 Coluna) */}
              <div className="md:col-span-1 bg-slate-950/80 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between shadow-inner">
                <div>
                  <div className="flex justify-between items-center mb-2.5">
                    <span className="text-[11px] font-black uppercase text-slate-300 flex items-center gap-1.5 whitespace-nowrap">
                      <ImageIcon className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" /> Galeria
                    </span>
                    <label className="cursor-pointer px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-bold flex items-center gap-1.5 transition-all shadow-sm whitespace-nowrap flex-shrink-0">
                      <Upload className="w-3 h-3" /> Adicionar
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleImageUpload}
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2 max-h-[200px] min-h-[150px] overflow-y-auto custom-scrollbar p-0.5 items-center justify-items-center">
                    {(activeServer?.images || []).map((img) => (
                      <div 
                        key={img.id} 
                        className={`relative group bg-slate-900 rounded-md border border-slate-800 overflow-hidden cursor-pointer flex items-center justify-center p-1 transition-all ${
                          (activeServer?.images || []).length === 1 
                            ? 'col-span-2 w-36 h-36 mx-auto' 
                            : 'w-full aspect-square'
                        }`}
                      >
                        <img 
                          src={img.url} 
                          alt="Miniatura" 
                          className="max-w-full max-h-full object-contain transition-transform group-hover:scale-105"
                          onClick={() => openImageModal(img.url)}
                        />
                        <div 
                          onClick={() => openImageModal(img.url)}
                          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                        >
                          <Maximize2 className="w-4 h-4 text-white drop-shadow" />
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteImage(img.id);
                          }}
                          className="absolute top-1 right-1 p-1 bg-rose-600/90 hover:bg-rose-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow"
                          title="Excluir Imagem"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}

                    {(!activeServer?.images || activeServer.images.length === 0) && (
                      <label className="col-span-2 border border-dashed border-slate-800/80 hover:border-blue-500/50 rounded-lg p-3 flex flex-col items-center justify-center gap-1.5 text-center cursor-pointer transition-colors min-h-[140px] bg-slate-900/40">
                        <Upload className="w-5 h-5 text-slate-500" />
                        <span className="text-[11px] text-slate-400 font-bold">Nenhuma imagem</span>
                        <span className="text-[9px] text-blue-400 font-black uppercase tracking-wider">Clique p/ Upload</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={handleImageUpload}
                        />
                      </label>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-800/50 text-[9px] text-slate-500 font-mono italic flex justify-between">
                  <span className="truncate">Clique para ampliar</span>
                  <span className="flex-shrink-0 ml-1">{activeServer?.images?.length || 0} fotos</span>
                </div>
              </div>

              {/* Quadro 2: Bloco de Anotações & Lista (Expandido - 2 Colunas com Barra de Rolagem) */}
              <div className="md:col-span-2 bg-slate-950/80 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between shadow-inner">
                <div className="flex-1 flex flex-col min-w-0">
                  <div className="flex justify-between items-center mb-2.5">
                    <span className="text-[11px] font-black uppercase text-slate-300 flex items-center gap-1.5 whitespace-nowrap">
                      <FileText className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" /> Bloco de Anotações & Observações
                      {saveStatus === 'saving' && (
                        <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded flex items-center gap-1 font-mono font-bold animate-pulse ml-1.5">
                          <RotateCcw className="w-2.5 h-2.5 animate-spin" /> Salvando...
                        </span>
                      )}
                      {saveStatus === 'saved' && (
                        <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded flex items-center gap-1 font-mono font-bold ml-1.5">
                          <Save className="w-2.5 h-2.5 text-emerald-400" /> Salvo no Servidor
                        </span>
                      )}
                      {saveStatus === 'error' && (
                        <span className="text-[9px] bg-rose-500/20 text-rose-300 border border-rose-500/40 px-1.5 py-0.5 rounded flex items-center gap-1 font-mono font-bold ml-1.5">
                          ⚠ Erro ao Salvar
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!isEditingNote ? (
                        <button 
                          onClick={() => setIsEditingNote(true)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded text-[10px] font-bold flex items-center gap-1 transition-all"
                        >
                          <Edit2 className="w-3 h-3" /> Editar
                        </button>
                      ) : (
                        <button 
                          onClick={handleSaveNoteText}
                          className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[10px] font-bold flex items-center gap-1 transition-all shadow-sm"
                        >
                          <Save className="w-3 h-3" /> Salvar
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditingNote ? (
                    <div className="space-y-2 flex-1 flex flex-col min-h-[150px]">
                      <textarea 
                        value={noteTextDraft}
                        onChange={(e) => setNoteTextDraft(e.target.value)}
                        placeholder="Escreva anotações ou observações detalhadas do servidor..."
                        className="w-full h-36 bg-slate-900 border border-slate-800 rounded p-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono resize-y custom-scrollbar min-h-[100px]"
                      />
                      <form onSubmit={handleAddChecklistItem} className="flex gap-1.5">
                        <input 
                          type="text" 
                          value={newCheckitemText}
                          onChange={(e) => setNewCheckitemText(e.target.value)}
                          placeholder="Novo item de lista..."
                          className="flex-1 bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-amber-500"
                        />
                        <button 
                          type="submit"
                          className="px-3 py-1 bg-amber-600/30 border border-amber-500/50 hover:bg-amber-600/50 text-amber-300 text-xs font-bold rounded transition-colors flex items-center gap-1 whitespace-nowrap"
                        >
                          <Plus className="w-3 h-3" /> Item
                        </button>
                      </form>
                    </div>
                  ) : (
                    <div className="space-y-2 flex-1 flex flex-col min-h-[150px]">
                      {/* Container com barra de rolagem expandida para ver mais texto */}
                      <div className="max-h-48 min-h-[80px] overflow-y-auto custom-scrollbar bg-slate-900/70 p-3 rounded-lg border border-slate-800/80">
                        <p className="text-xs text-slate-200 whitespace-pre-wrap font-mono leading-relaxed">
                          {activeServer?.noteText || "Nenhuma anotação cadastrada. Clique em Editar para adicionar."}
                        </p>
                      </div>

                      {(activeServer?.notes || []).length > 0 && (
                        <div className="max-h-32 overflow-y-auto space-y-1 custom-scrollbar pr-1 mt-1">
                          {(activeServer?.notes || []).map((item) => (
                            <div key={item.id} className="flex items-center justify-between text-xs bg-slate-900/60 px-2.5 py-1 rounded border border-slate-800/50">
                              <button 
                                onClick={() => handleToggleChecklistItem(item.id)}
                                className="flex items-center gap-2 text-left flex-1 min-w-0"
                              >
                                {item.completed ? (
                                  <CheckSquare className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                                ) : (
                                  <Square className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                                )}
                                <span className={`truncate text-[11px] ${item.completed ? 'line-through text-slate-500' : 'text-slate-200 font-medium'}`}>
                                  {item.text}
                                </span>
                              </button>
                              <button 
                                onClick={() => handleDeleteChecklistItem(item.id)}
                                className="text-slate-600 hover:text-rose-400 p-0.5 ml-1 transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-800/50 text-[9px] text-slate-500 font-mono italic flex justify-between">
                  <span>Anotações & Checklist</span>
                  <span>{(activeServer?.notes || []).filter(n => n.completed).length}/{(activeServer?.notes || []).length} itens concluídos</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-5 flex-none">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-blue-400 font-black uppercase tracking-wider flex items-center gap-2"><Activity className="w-4 h-4" /> Predictive Health</div>
                <span className="text-[10px] font-black bg-blue-500/20 px-2 py-0.5 rounded text-blue-300 uppercase">AI-EXTRACT</span>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed italic font-medium">"{aiInsight}"</p>
            </div>

            <div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col shadow-inner">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6">Resource Monitors</h3>
              <div className="space-y-8 flex-1">
                <MiniLineMonitor label="CPU Consumption" value={metrics.cpu} status={metrics.cpu > 70 ? 'High' : 'Stable'} color={metrics.cpu > 70 ? 'rose' : 'emerald'} />
                <MiniLineMonitor label="Memory Load" value={metrics.ram} status="Optimized" color="blue" />
                <div className="mt-2 space-y-1.5">
                  <div className="flex justify-between items-center text-[11px] text-slate-400 uppercase font-black"><span>Cluster Sync</span><span className="text-emerald-500">100%</span></div>
                  <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden shadow-inner"><div className="h-full bg-emerald-500 w-full shadow-[0_0_10px_#10b981]"></div></div>
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-slate-800">
                <div className="flex items-center gap-2 text-slate-500 font-black"><Info className="w-4 h-4" /><span className="text-[10px] uppercase tracking-tighter">Zabbix v7.0.4-LTS Connected</span></div>
              </div>
            </div>
          </div>
        </div>
      </>
    )}
      </main>

      {/* Modal Foto Tamanho Real e Zoom Interativo */}
      <AnimatePresence>
        {selectedFullImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col bg-slate-950/95 backdrop-blur-md p-4 overflow-hidden"
            onClick={() => setSelectedFullImage(null)}
          >
            {/* Barra de Ferramentas de Zoom & Controle */}
            <div 
              className="flex justify-between items-center bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 mb-3 shadow-2xl z-20 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 text-slate-200 text-xs font-bold font-mono">
                <ImageIcon className="w-4 h-4 text-blue-400" />
                <span>Visualizador de Imagem</span>
                <span className="text-[10px] bg-blue-950 text-blue-300 border border-blue-800/60 px-2 py-0.5 rounded-full font-black">
                  {imageZoom === 'fit' ? 'Ajustado' : `${imageZoom}%`}
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <button 
                  onClick={() => setImageZoom('fit')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    imageZoom === 'fit' 
                      ? 'bg-blue-600 text-white shadow' 
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                  title="Ajustar à Tela"
                >
                  Ajustar à Tela
                </button>

                <button 
                  onClick={() => setImageZoom(100)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    imageZoom === 100 
                      ? 'bg-blue-600 text-white shadow' 
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                  title="100% Tamanho Real Nativo"
                >
                  100% Tamanho Real
                </button>

                <div className="h-4 w-px bg-slate-800 mx-1 hidden sm:block" />

                <button 
                  onClick={() => setImageZoom(prev => typeof prev === 'number' ? Math.max(25, prev - 25) : 75)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
                  title="Diminuir Zoom (-25%)"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>

                <button 
                  onClick={() => setImageZoom(prev => typeof prev === 'number' ? Math.min(500, prev + 25) : 125)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
                  title="Aumentar Zoom (+25%)"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>

                <button 
                  onClick={() => setImageZoom('fit')}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
                  title="Resetar Zoom"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <div className="h-4 w-px bg-slate-800 mx-1 hidden sm:block" />

                <button 
                  onClick={() => {
                    const win = window.open();
                    if (win) {
                      win.document.write(`
                        <html>
                          <head><title>Visualizar Imagem em Tamanho Real</title></head>
                          <body style="margin:0; background:#0f172a; display:flex; justify-content:center; align-items:center; min-height:100vh;">
                            <img src="${selectedFullImage}" style="max-width:none;" />
                          </body>
                        </html>
                      `);
                    }
                  }}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-blue-400 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
                  title="Abrir em Nova Aba"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Nova Aba
                </button>

                <button 
                  onClick={() => setSelectedFullImage(null)}
                  className="p-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors ml-2 shadow-lg"
                  title="Fechar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Area de Imagem com Rolagem e Zoom */}
            <div 
              className="flex-1 w-full h-full overflow-auto custom-scrollbar flex items-center justify-center p-4 bg-slate-950 rounded-xl border border-slate-800 shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="m-auto flex justify-center items-center">
                <img 
                  src={selectedFullImage} 
                  alt="Imagem em tamanho real" 
                  style={
                    imageZoom === 'fit' 
                      ? { maxWidth: '100%', maxHeight: 'calc(100vh - 120px)', objectFit: 'contain' }
                      : { width: `${imageZoom}%`, maxWidth: 'none', height: 'auto', display: 'block' }
                  }
                  className="rounded-lg shadow-2xl border border-slate-800/80 transition-all duration-150"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
      <div className={`text-4xl font-mono font-black leading-none ${textColors[status]} mb-1`}>{value}</div>
      <div className="text-xs text-slate-500 mt-2 font-mono uppercase tracking-tight font-black">{subtitle}</div>
    </motion.div>
  );
}

function PartitionRow({ label, used, freeText, totalText }: any) {
  const isHigh = used > 85;
  return (
    <div className="space-y-2.5">
      <div className="flex justify-between text-sm font-black uppercase">
        <span className="font-mono text-slate-100">{label}</span>
        <span className={isHigh ? "text-rose-400 animate-pulse" : "text-emerald-400"}>{used}% Used</span>
      </div>
      <div className="h-4.5 w-full bg-slate-950 rounded-full flex overflow-hidden ring-1 ring-white/10 p-1">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${used}%` }}
          className={`h-full rounded-full transition-all ${isHigh ? 'bg-rose-500 shadow-[0_0_15px_#ef4444]' : 'bg-emerald-500 shadow-[0_0_15px_#10b981]'}`} 
        />
      </div>
      <div className="flex justify-between text-xs text-slate-400 font-black font-mono uppercase tracking-tighter">
        <span>Total: {totalText}</span>
        <span className={isHigh ? "text-rose-400" : "text-slate-300"}>{freeText} Free</span>
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
    <div className="space-y-3">
      <div className="flex justify-between items-center text-[11px] uppercase font-black tracking-tight">
        <span className="text-slate-300">{label}</span>
        <span className={`font-mono font-black ${textMap[color]}`}>{status}</span>
      </div>
      <div className="h-12 bg-slate-950 border-2 border-slate-800 flex items-end p-1.5 gap-1.5 rounded-md overflow-hidden">
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
