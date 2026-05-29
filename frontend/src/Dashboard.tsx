import React, { useState, useEffect } from 'react';

// Types
interface EntityItem {
  entity_type: string;
  entity_value: string;
  context_text?: string;
  confidence_score: number;
}

interface RelationshipItem {
  source: string;
  target: string;
  type: string;
}

interface TimelineEvent {
  date: string;
  event: string;
}

interface SimilarCase {
  title: string;
  citation: string;
  court: string;
  summary: string;
}

interface ChatMessage {
  sender: 'user' | 'assistant';
  text: string;
  structuredResponse?: {
    direct_answer: string;
    explanation: string;
    ipc_sections: { section: string; title: string; description: string }[];
    pro_tip: string;
  };
}

interface CaseDocument {
  id: string;
  filename: string;
  status: string;
  ocr_text: string;
  created_at?: string;
}

const API_BASE = "http://127.0.0.1:8000";

export const Dashboard: React.FC = () => {
  // Portal State
  const [portalMode, setPortalMode] = useState<'lawyer' | 'client'>('lawyer');

  // Document list and active selection
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>("doc-default-ref");

  // Lawyer specific tab state
  const [leftTab, setLeftTab] = useState<'document' | 'precedents' | 'graph' | 'timeline' | 'statutes'>('document');

  // Statute Explorer states
  const [statuteAct, setStatuteAct] = useState<string>('Indian Penal Code');
  const [statuteSection, setStatuteSection] = useState<string>('');
  const [statuteKeyword, setStatuteKeyword] = useState<string>('');
  const [statuteResults, setStatuteResults] = useState<any>(null);
  const [statuteLoading, setStatuteLoading] = useState<boolean>(false);
  const [selectedStatuteCase, setSelectedStatuteCase] = useState<any>(null);

  const handleStatuteSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setStatuteLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/dataset/statute-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          act: statuteAct,
          section: statuteSection,
          query: statuteKeyword
        })
      });
      if (res.ok) {
        const data = await res.json();
        setStatuteResults(data);
        setSelectedStatuteCase(null);
      } else {
        console.error("Failed to query statute dataset");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setStatuteLoading(false);
    }
  };

  // Shared Core Case Data
  const [documentText, setDocumentText] = useState<string>("");
  const [extractedData, setExtractedData] = useState<any>(null);
  const [similarCases, setSimilarCases] = useState<SimilarCase[]>([]);

  // Chatbot states
  const [lawyerChatMessages, setLawyerChatMessages] = useState<ChatMessage[]>([
    {
      sender: 'assistant',
      text: "Legal Research Assistant active. Upload case documents on the left. I will retrieve context to answer statutory and research queries. Try using the quick Prompts below."
    }
  ]);
  const [clientChatMessages, setClientChatMessages] = useState<ChatMessage[]>([
    {
      sender: 'assistant',
      text: "Hello! I am your AI Legal Guide. I'm here to explain your case in clear, simple terms. Ask me any questions about what is happening, what your options are, or what documents you should get ready."
    }
  ]);

  const [chatInput, setChatInput] = useState<string>('');
  const [chatLoading, setChatLoading] = useState<boolean>(false);

  // Grounding state for the chatbot
  const [chatbotSource, setChatbotSource] = useState<'document' | 'dataset' | 'combined'>('combined');
  const [ragIndexBuilding, setRagIndexBuilding] = useState<boolean>(false);

  // Status and loading states
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [selectedEntity, setSelectedEntity] = useState<EntityItem | null>(null);

  const handleRebuildIndex = async () => {
    setRagIndexBuilding(true);
    setStatusMessage("Rebuilding FAISS vector database from synthetic legal dataset (CSV)...");
    try {
      const res = await fetch(`${API_BASE}/api/rag/build`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setStatusMessage(data.message || "Successfully rebuilt FAISS vector index.");
      } else {
        const data = await res.json();
        setStatusMessage(`Build failed: ${data.detail || "Server error"}`);
      }
    } catch (err: any) {
      setStatusMessage(`Error rebuilding index: ${err.message}`);
    } finally {
      setRagIndexBuilding(false);
    }
  };

  // SVG network graph nodes
  const [graphNodes, setGraphNodes] = useState<any[]>([]);
  const [graphLinks, setGraphLinks] = useState<any[]>([]);

  // Default entity color map
  const entityColors: Record<string, { bg: string; border: string; text: string; badge: string; colorHex: string }> = {
    judges: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-400', badge: 'bg-red-100 text-red-800 border border-red-200', colorHex: '#DC2626' },
    lawyers: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-400', badge: 'bg-blue-100 text-blue-800 border border-blue-200', colorHex: '#2563EB' },
    ipc_sections: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-805 border border-amber-200', colorHex: '#D97706' },
    courts: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-800 border border-purple-200', colorHex: '#7C3AED' },
    companies: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-400', badge: 'bg-emerald-100 text-emerald-800 border border-emerald-200', colorHex: '#059669' },
    fir_numbers: { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700', badge: 'bg-pink-100 text-pink-800 border border-pink-200', colorHex: '#DB2777' },
    case_numbers: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', badge: 'bg-cyan-100 text-cyan-805 border border-cyan-200', colorHex: '#0891B2' },
    organizations: { bg: 'bg-slate-100', border: 'border-white/5', text: 'text-slate-300', badge: 'bg-white/10 text-slate-200 border border-slate-300', colorHex: '#475569' },
    persons: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-400', badge: 'bg-indigo-100 text-indigo-800 border border-indigo-200', colorHex: '#4F46E5' },
    locations: { bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-700', badge: 'bg-teal-100 text-teal-800 border border-teal-200', colorHex: '#0D9488' },
    dates: { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', badge: 'bg-sky-100 text-sky-850 border border-sky-200', colorHex: '#0284C7' }
  };

  // Fetch document list on load
  const fetchDocuments = async (selectNewId?: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/documents`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
        if (data.length > 0) {
          if (selectNewId) {
            setSelectedDocId(selectNewId);
          } else if (!selectedDocId || !data.some((d: any) => d.id === selectedDocId)) {
            setSelectedDocId(data[0].id);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching document list:", err);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  // Fetch details of selected document
  useEffect(() => {
    if (!selectedDocId) return;

    const loadDocumentData = async () => {
      setActionLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/documents/${selectedDocId}`);
        if (res.ok) {
          const doc = await res.json();
          setDocumentText(doc.ocr_text);

          // Trigger entity extraction to load structured parameters
          const extRes = await fetch(`${API_BASE}/api/extract-entities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: doc.ocr_text, filename: doc.filename })
          });

          if (extRes.ok) {
            const extData = await extRes.json();
            setExtractedData(extData);

            // Fetch similar case law matches
            try {
              const similarRes = await fetch(`${API_BASE}/api/similar-cases`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: doc.ocr_text.slice(0, 1000), k: 3 })
              });
              if (similarRes.ok) {
                const similarData = await similarRes.json();
                setSimilarCases(similarData || []);
              }
            } catch (simErr) {
              console.error("Failed to query similar cases:", simErr);
            }
          }
        }
      } catch (err) {
        console.error("Failed loading document details:", err);
      } finally {
        setActionLoading(false);
      }
    };

    loadDocumentData();
  }, [selectedDocId]);

  // Update active document status
  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedDocId) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/documents/${selectedDocId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        setStatusMessage(`Case status updated to '${newStatus}'`);
        fetchDocuments(selectedDocId);
      }
    } catch (err) {
      console.error(err);
      setStatusMessage("Failed to update status.");
    } finally {
      setActionLoading(false);
    }
  };

  // Re-generate Graph coordinates when extractedData updates
  useEffect(() => {
    if (!extractedData) return;
    const nodes: any[] = [];
    const nodeMap = new Map();
    let index = 0;

    const addNode = (id: string, type: string) => {
      if (!id) return;
      const key = `${type}-${id}`;
      if (!nodeMap.has(key)) {
        const angle = (index * 2 * Math.PI) / 8;
        const radius = 100 + (index % 2) * 35;
        const x = 230 + radius * Math.cos(angle);
        const y = 190 + radius * Math.sin(angle);
        const nodeObj = { id, type, x, y };
        nodeMap.set(key, nodeObj);
        nodes.push(nodeObj);
        index++;
      }
    };

    extractedData.judges?.forEach((n: string) => addNode(n, 'judges'));
    extractedData.lawyers?.forEach((n: string) => addNode(n, 'lawyers'));
    extractedData.ipc_sections?.forEach((n: string) => addNode(n, 'ipc_sections'));
    extractedData.courts?.forEach((n: string) => addNode(n, 'courts'));
    extractedData.companies?.forEach((n: string) => addNode(n, 'companies'));
    extractedData.persons?.forEach((n: string) => addNode(n, 'persons'));
    extractedData.fir_numbers?.forEach((n: string) => addNode(n, 'fir_numbers'));

    const links = (extractedData.relationships || []).map((rel: any) => {
      const sourceNode = nodes.find(n => n.id === rel.source);
      const targetNode = nodes.find(n => n.id === rel.target);
      return {
        source: sourceNode || { x: 120, y: 120 },
        target: targetNode || { x: 300, y: 300 },
        type: rel.type,
        sourceId: rel.source,
        targetId: rel.target
      };
    });

    setGraphNodes(nodes);
    setGraphLinks(links);
  }, [extractedData]);

  // Document Upload & OCR pipeline trigger
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setActionLoading(true);
    setStatusMessage('Uploading legal document and running OCR pipeline...');

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/api/analyze-document`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const newId = data.document_id;

        setStatusMessage('Analysis complete. Document successfully indexed.');
        await fetchDocuments(newId);

        setLawyerChatMessages(prev => [
          ...prev,
          {
            sender: 'assistant',
            text: `Successfully uploaded and parsed "${file.name}". I have indexed this file into your workspace and extracted parameters. You can ask me legal questions about this document.`
          }
        ]);

        setClientChatMessages(prev => [
          ...prev,
          {
            sender: 'assistant',
            text: `A new case document "${file.name}" has been uploaded. I've simplified it for you. What would you like to understand first?`
          }
        ]);
      } else {
        const errorData = await res.json();
        setStatusMessage(`Upload failed: ${errorData.detail || 'Server error'}`);
      }
    } catch (err: any) {
      setStatusMessage(`Network error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Re-extract entities when document editor text changes
  const triggerManualAnalysis = async () => {
    if (!documentText.trim()) return;
    setActionLoading(true);
    setStatusMessage('Executing semantic entity extraction on current text...');

    try {
      const currentDoc = documents.find(d => d.id === selectedDocId);
      const res = await fetch(`${API_BASE}/api/extract-entities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: documentText, filename: currentDoc?.filename || 'workspace_draft.txt' })
      });

      if (res.ok) {
        const data = await res.json();
        setExtractedData(data);
        setStatusMessage('Text analysis and entity index updated.');

        // Query vector DB precedents
        try {
          const precedentsRes = await fetch(`${API_BASE}/api/similar-cases`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: documentText.slice(0, 1000), k: 3 })
          });
          if (precedentsRes.ok) {
            const precedentsList = await precedentsRes.json();
            setSimilarCases(precedentsList || []);
          }
        } catch (dbErr) {
          console.error(dbErr);
        }
      } else {
        setStatusMessage('Analysis failed. Verify server status.');
      }
    } catch (err: any) {
      setStatusMessage(`Analysis error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Chatbot submission
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userQuery = chatInput;
    const isLawyer = portalMode === 'lawyer';

    if (isLawyer) {
      setLawyerChatMessages(prev => [...prev, { sender: 'user', text: userQuery }]);
    } else {
      setClientChatMessages(prev => [...prev, { sender: 'user', text: userQuery }]);
    }

    setChatInput('');
    setChatLoading(true);

    const endpoint = isLawyer ? '/api/ask' : '/api/ask-client';

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userQuery,
          context: chatbotSource === 'dataset' ? '' : (documentText || ''),
          use_rag: chatbotSource !== 'document'
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (isLawyer) {
          setLawyerChatMessages(prev => [...prev, {
            sender: 'assistant',
            text: data.direct_answer,
            structuredResponse: data
          }]);
        } else {
          setClientChatMessages(prev => [...prev, {
            sender: 'assistant',
            text: data.direct_answer,
            structuredResponse: data
          }]);
        }
      } else {
        const errMsg = 'The server rejected this request. Verify active backend.';
        if (isLawyer) {
          setLawyerChatMessages(prev => [...prev, { sender: 'assistant', text: errMsg }]);
        } else {
          setClientChatMessages(prev => [...prev, { sender: 'assistant', text: errMsg }]);
        }
      }
    } catch (err: any) {
      const errMsg = `Error connecting to AI service: ${err.message}`;
      if (isLawyer) {
        setLawyerChatMessages(prev => [...prev, { sender: 'assistant', text: errMsg }]);
      } else {
        setClientChatMessages(prev => [...prev, { sender: 'assistant', text: errMsg }]);
      }
    } finally {
      setChatLoading(false);
    }
  };

  // Render text segments with highlighted spans
  const renderHighlightedText = () => {
    if (!extractedData || !extractedData.raw_entities) {
      return <div className="whitespace-pre-wrap leading-relaxed text-slate-300 font-mono text-sm">{documentText}</div>;
    }

    const entities = [...(extractedData.raw_entities || [])].sort((a, b) => b.entity_value.length - a.entity_value.length);
    const parts: React.ReactNode[] = [];
    let currentIdx = 0;
    const allMatches: { start: number; end: number; entity: EntityItem }[] = [];

    entities.forEach(entity => {
      let idx = documentText.indexOf(entity.entity_value);
      while (idx !== -1) {
        if (!allMatches.some(m => (idx >= m.start && idx < m.end) || (idx + entity.entity_value.length > m.start && idx + entity.entity_value.length <= m.end))) {
          allMatches.push({
            start: idx,
            end: idx + entity.entity_value.length,
            entity
          });
        }
        idx = documentText.indexOf(entity.entity_value, idx + 1);
      }
    });

    allMatches.sort((a, b) => a.start - b.start);

    allMatches.forEach(match => {
      if (match.start > currentIdx) {
        parts.push(documentText.substring(currentIdx, match.start));
      }
      const styles = entityColors[match.entity.entity_type] || { bg: 'rgba(255,255,255,0.05)', border: 'border-white/5', text: 'text-slate-200', badge: 'bg-slate-800 text-slate-500' };

      parts.push(
        <span
          key={`${match.start}-${match.entity.entity_value}`}
          onClick={() => setSelectedEntity(match.entity)}
          className={`cursor-pointer inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold border ${styles.bg} ${styles.border} ${styles.text} mx-0.5 transition-transform hover:scale-105`}
        >
          {match.entity.entity_value}
          <span className={`text-xs px-1.5 rounded-sm uppercase tracking-wider font-mono ${styles.badge}`}>
            {match.entity.entity_type.replace('_', ' ')}
          </span>
        </span>
      );
      currentIdx = match.end;
    });

    if (currentIdx < documentText.length) {
      parts.push(documentText.substring(currentIdx));
    }

    return <div className="whitespace-pre-wrap leading-relaxed text-slate-300 font-mono text-sm">{parts}</div>;
  };

  const selectedDoc = documents.find(d => d.id === selectedDocId);
  const activeStatus = selectedDoc?.status || "Under Review";

  const lawyerPrompts = [
    { title: 'Case Summary', prompt: 'Provide a structured summary of the uploaded case details.' },
    { title: 'Statutes & Sections', prompt: 'List all statutory sections mentioned in this case and explain their penalties.' },
    { title: 'Timeline & Events', prompt: 'Generate a chronological timeline of events based on this document.' },
    { title: 'Core Dispute', prompt: 'What is the primary factual dispute and core legal questions in this case?' }
  ];

  const clientPrompts = [
    { title: 'Explain My Case', prompt: 'Explain the details of my case and what I am charged with in simple layman terms.' },
    { title: 'What is my Next Step?', prompt: 'What specific steps should I take next? What documents do I need to prepare?' },
    { title: 'Is it Bailable?', prompt: 'Are the offenses listed in my case bailable? What does that mean for me?' },
    { title: 'How long will it take?', prompt: 'What is the typical legal process for this kind of case in court?' }
  ];

  const statuses = ["OCR Parsing", "Under Review", "Hearing Scheduled", "Resolved"];
  const getStatusIndex = (statusStr: string) => {
    const idx = statuses.indexOf(statusStr);
    return idx === -1 ? 1 : idx;
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#121214] text-slate-100 font-sans antialiased">

      {/* PROFESSIONAL PREMIUM HEADER */}
      <header className="h-20 bg-[#0A0E1A]/85 backdrop-blur-md border-b border-white/5/60 px-8 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-indigo-950/40 border border-indigo-900/30 flex items-center justify-center rounded-lg shadow-inner">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-indigo-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" />
            </svg>
          </div>
          <div>
            <span className="font-serif text-xl font-extrabold tracking-wider text-slate-100">AI legal Agent</span>
            <span className="block text-xs text-indigo-600/80 tracking-widest uppercase font-semibold mt-0.5">Enterprise Legal Assistant</span>
          </div>
        </div>

        {/* PORTAL MODE ROLE SWITCHER */}
        <div className="flex items-center gap-2 bg-[#1C1C1F] border border-white/5 p-1 rounded-full shadow-inner">
          <button
            onClick={() => { setPortalMode('lawyer'); setChatInput(''); }}
            className={`flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold tracking-wide transition-all ${portalMode === 'lawyer'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'text-slate-500 hover:text-slate-200 hover:bg-white/10'
              }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.03 0 1.9.693 2.166 1.638m-7.377 12.408-3.285-3.285m0 0 3.285-3.285m-3.285 3.285h16.24" />
            </svg>
            Lawyer Portal
          </button>
          <button
            onClick={() => { setPortalMode('client'); setChatInput(''); }}
            className={`flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold tracking-wide transition-all ${portalMode === 'client'
                ? 'bg-emerald-600/90 text-white shadow-sm shadow-emerald-150'
                : 'text-slate-500 hover:text-slate-200 hover:bg-white/10'
              }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
            Client Workspace
          </button>
        </div>

        {/* ACTIVE CASE OR ACCOUNT */}
        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col text-right">
            <span className="text-xs font-semibold text-slate-300">Vignesh Prasad</span>
            <span className="text-xs text-slate-500 font-mono">ID: IN-895BE5D3</span>
          </div>
          <div className="h-9 w-9 bg-[#27272A] rounded-full border border-white/5 flex items-center justify-center font-bold text-xs text-indigo-600">
            VP
          </div>
        </div>
      </header>

      {/* SYSTEM MESSAGE PANEL */}
      {statusMessage && (
        <div className="bg-blue-50/50 border-b border-white/5/60 px-8 py-3 flex items-center justify-between text-xs animate-fade-in">
          <span className="text-slate-300 flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="font-semibold text-indigo-600/90">SYSTEM:</span> {statusMessage}
          </span>
          <button onClick={() => setStatusMessage('')} className="text-slate-500 hover:text-slate-300 font-bold">✕</button>
        </div>
      )}

      {/* PORTAL MAIN AREA */}
      {portalMode === 'lawyer' ? (

        /* ==================== LAWYER PORTAL ==================== */
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 p-8 max-w-[1700px] w-full mx-auto animate-fade-in">

          {/* LAWYER LEFT COLUMN: Case selector, editor tabs, graph, matching precedents */}
          <div className="lg:col-span-7 flex flex-col gap-6">

            {/* Upper Info Row with Case Selector and Status Manager */}
            <div className="glass-panel p-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-sm font-bold text-slate-300 uppercase tracking-widest block">Active Litigation Case</label>
                <select
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className="bg-[#0A0D16] border border-white/5/60 rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  {documents.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.filename} ({doc.status})
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Update Dropdown */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-bold text-slate-300 uppercase tracking-widest block">Update Case Status</label>
                <div className="flex gap-2">
                  <select
                    value={activeStatus}
                    onChange={(e) => handleUpdateStatus(e.target.value)}
                    className="bg-[#0A0D16] border border-white/5/60 rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    {statuses.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${activeStatus === 'Resolved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                      activeStatus === 'Hearing Scheduled' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        activeStatus === 'Under Review' ? 'bg-blue-500/10 text-indigo-600 border border-blue-500/20' :
                          'bg-[#1C1C1F]0/10 text-slate-500 border border-slate-500/20'
                    }`}>
                    {activeStatus}
                  </span>
                </div>
              </div>
            </div>

            {/* Main Workspace Panel */}
            <div className="glass-panel flex-1 flex flex-col overflow-hidden min-h-[620px]">

              {/* Navigation Tab Row */}
              <div className="flex border-b border-white/5 bg-[#252529] text-xs font-semibold tracking-wider uppercase overflow-x-auto">
                <button
                  onClick={() => setLeftTab('document')}
                  className={`px-4 py-4 text-center border-b-2 transition-all shrink-0 ${leftTab === 'document' ? 'border-blue-500 text-indigo-600 bg-[#0E1325]/45' : 'border-transparent text-slate-500 hover:text-slate-200 hover:bg-slate-100/30'}`}
                >
                  Document Editor
                </button>
                <button
                  onClick={() => setLeftTab('precedents')}
                  className={`px-4 py-4 text-center border-b-2 transition-all shrink-0 ${leftTab === 'precedents' ? 'border-blue-500 text-indigo-600 bg-[#0E1325]/45' : 'border-transparent text-slate-500 hover:text-slate-200 hover:bg-slate-100/30'}`}
                >
                  Precedent Match (RAG)
                </button>
                <button
                  onClick={() => setLeftTab('statutes')}
                  className={`px-4 py-4 text-center border-b-2 transition-all shrink-0 ${leftTab === 'statutes' ? 'border-blue-500 text-indigo-600 bg-[#0E1325]/45' : 'border-transparent text-slate-500 hover:text-slate-200 hover:bg-slate-100/30'}`}
                >
                  Statute Explorer
                </button>
                <button
                  onClick={() => setLeftTab('graph')}
                  className={`px-4 py-4 text-center border-b-2 transition-all shrink-0 ${leftTab === 'graph' ? 'border-blue-500 text-indigo-600 bg-[#0E1325]/45' : 'border-transparent text-slate-500 hover:text-slate-200 hover:bg-slate-100/30'}`}
                >
                  Network Graph
                </button>
                <button
                  onClick={() => setLeftTab('timeline')}
                  className={`px-4 py-4 text-center border-b-2 transition-all shrink-0 ${leftTab === 'timeline' ? 'border-blue-500 text-indigo-600 bg-[#0E1325]/45' : 'border-transparent text-slate-500 hover:text-slate-200 hover:bg-slate-100/30'}`}
                >
                  Timeline
                </button>
              </div>

              {/* Panel Body */}
              <div className="p-6 flex-1 flex flex-col justify-between">

                {/* DOCUMENT EDITOR SUBTAB */}
                {leftTab === 'document' && (
                  <div className="space-y-6 flex-1 flex flex-col justify-between">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                      {/* Document Upload Zone */}
                      <div className="md:col-span-1">
                        <label className="flex flex-col items-center justify-center border border-dashed border-slate-300 hover:border-indigo-500 bg-[#1C1C1F] hover:bg-slate-100/70 rounded-xl p-5 h-[140px] cursor-pointer transition-all shadow-inner group">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-6 h-6 text-slate-500 mb-2 group-hover:text-indigo-600 transition-colors">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                          </svg>
                          <span className="text-sm font-bold text-slate-100 group-hover:text-slate-100 transition-colors">Intake Case File</span>
                          <span className="text-xs text-slate-500 mt-1">PDF or image file</span>
                          <input type="file" onChange={handleFileUpload} accept=".pdf,.png,.jpg,.jpeg" className="hidden" disabled={actionLoading} />
                        </label>
                        <button
                          onClick={triggerManualAnalysis}
                          disabled={actionLoading || !documentText.trim()}
                          className="w-full mt-3 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/60 text-sm font-bold text-white rounded-lg transition-colors shadow-lg shadow-blue-900/20"
                        >
                          Run Semantic Extraction
                        </button>
                      </div>

                      {/* Extracted Metadata Overview */}
                      <div className="md:col-span-2 space-y-3">
                        <span className="text-sm font-bold text-slate-300 uppercase tracking-widest block">Core Extracted Parameters</span>
                        {extractedData ? (
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {extractedData.case_numbers?.length > 0 && (
                              <div className="p-2.5 bg-[#1C1C1F] border border-white/5 rounded-lg">
                                <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider mb-0.5">Case Citations</span>
                                <span className="text-slate-300 font-mono font-medium">{extractedData.case_numbers.join(', ')}</span>
                              </div>
                            )}
                            {extractedData.courts?.length > 0 && (
                              <div className="p-2.5 bg-[#1C1C1F] border border-white/5 rounded-lg">
                                <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider mb-0.5">Jurisdiction</span>
                                <span className="text-slate-300 font-medium truncate block">{extractedData.courts.join(', ')}</span>
                              </div>
                            )}
                            {extractedData.judges?.length > 0 && (
                              <div className="p-2.5 bg-[#1C1C1F] border border-white/5 rounded-lg">
                                <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider mb-0.5">Presiding Bench</span>
                                <span className="text-slate-300 font-medium truncate block">{extractedData.judges.join(', ')}</span>
                              </div>
                            )}
                            {extractedData.ipc_sections?.length > 0 && (
                              <div className="p-2.5 bg-[#1C1C1F] border border-white/5 rounded-lg">
                                <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider mb-0.5">Indian Penal Code</span>
                                <span className="text-slate-300 font-medium truncate block">{extractedData.ipc_sections.join(', ')}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500 italic pt-2">No litigation parameters indexed. Upload a file or insert text below.</p>
                        )}
                      </div>
                    </div>

                    {/* Text Editors */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/5">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-2.5">Raw Text Content</span>
                        <textarea
                          value={documentText}
                          onChange={(e) => setDocumentText(e.target.value)}
                          className="w-full flex-1 min-h-[300px] h-[340px] bg-[#121214] border border-white/5/60 rounded-lg p-3 font-mono text-sm text-slate-300 focus:outline-none focus:border-blue-600 resize-none transition-colors"
                          placeholder="Raw OCR case text will load here..."
                        />
                      </div>

                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-2.5">Semantic Analysis Markup</span>
                        <div className="w-full flex-1 min-h-[300px] h-[340px] bg-[#121214] border border-white/5/60 rounded-lg p-4 overflow-y-auto">
                          {renderHighlightedText()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* PRECEDENT MATCH SUBTAB */}
                {leftTab === 'precedents' && (
                  <div className="space-y-6 flex-1">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">FAISS Case Law Matches (RAG Context)</h4>
                    {similarCases.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No precedents matching document text found. Try indexing your dataset.</p>
                    ) : (
                      <div className="space-y-4">
                        {similarCases.map((c, idx) => (
                          <div key={idx} className="p-4 bg-[#1C1C1F] border border-white/5 rounded-xl transition-all hover:bg-slate-100/30">
                            <div className="flex justify-between items-start gap-3 mb-2">
                              <h5 className="text-xs font-bold text-indigo-600 tracking-wide">{c.title}</h5>
                              <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono border border-slate-700">{c.citation}</span>
                            </div>
                            <span className="text-xs text-slate-500 block mb-2">{c.court}</span>
                            <p className="text-sm text-slate-350 leading-relaxed font-sans">{c.summary}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* NETWORK GRAPH SUBTAB */}
                {leftTab === 'graph' && (
                  <div className="space-y-6 flex-1">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Litigant Network Graph</h4>
                    <div className="relative w-full bg-[#080A12] rounded-xl border border-white/5/60 overflow-hidden flex items-center justify-center min-h-[400px]">
                      {graphNodes.length === 0 ? (
                        <span className="text-slate-500 text-xs italic">No graph nodes detected. Upload a case document.</span>
                      ) : (
                        <svg width="500" height="400" className="w-full max-h-[400px]">
                          <defs>
                            <marker id="arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                              <path d="M 0 0 L 10 5 L 0 10 z" fill="#3B82F6" />
                            </marker>
                          </defs>

                          {/* Relations Links */}
                          {graphLinks.map((link, idx) => (
                            <g key={`link-${idx}`}>
                              <line
                                x1={link.source.x}
                                y1={link.source.y}
                                x2={link.target.x}
                                y2={link.target.y}
                                stroke="rgba(255,255,255,0.06)"
                                strokeWidth="1.2"
                                markerEnd="url(#arrow)"
                              />
                              <text
                                x={(link.source.x + link.target.x) / 2}
                                y={(link.source.y + link.target.y) / 2 - 4}
                                fill="#475569"
                                fontSize="7"
                                fontWeight="bold"
                                textAnchor="middle"
                              >
                                {link.type}
                              </text>
                            </g>
                          ))}

                          {/* Entity Nodes */}
                          {graphNodes.map((node, idx) => {
                            const config = entityColors[node.type] || { colorHex: '#475569' };
                            return (
                              <g key={`node-${idx}`} className="cursor-pointer" onClick={() => setSelectedEntity({ entity_type: node.type, entity_value: node.id, confidence_score: 1.0 })}>
                                <circle
                                  cx={node.x}
                                  cy={node.y}
                                  r="8"
                                  fill={config.colorHex}
                                  fillOpacity="0.2"
                                  stroke={config.colorHex}
                                  strokeWidth="1.5"
                                />
                                <circle
                                  cx={node.x}
                                  cy={node.y}
                                  r="3"
                                  fill={config.colorHex}
                                />
                                <text
                                  x={node.x}
                                  y={node.y - 12}
                                  fill="#E2E8F0"
                                  fontSize="8"
                                  fontWeight="bold"
                                  textAnchor="middle"
                                >
                                  {node.id.length > 12 ? node.id.substring(0, 10) + '..' : node.id}
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                      )}
                    </div>

                    {selectedEntity && (
                      <div className="bg-[#1C1C1F] border border-white/5 rounded-lg p-3.5 text-xs flex justify-between items-center animate-fade-in">
                        <div>
                          <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider">Selected Entity Value</span>
                          <strong className="text-slate-200">{selectedEntity.entity_value}</strong>
                          <span className="text-indigo-600 font-mono text-xs ml-3 uppercase font-semibold">({selectedEntity.entity_type.replace('_', ' ')})</span>
                        </div>
                        <button onClick={() => setSelectedEntity(null)} className="text-xs text-slate-500 hover:text-slate-300 font-bold">✕</button>
                      </div>
                    )}
                  </div>
                )}

                {/* TIMELINE SUBTAB */}
                {leftTab === 'timeline' && (
                  <div className="space-y-6 flex-1">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Case Chronology Flow</h4>
                    {extractedData && extractedData.timeline && extractedData.timeline.length > 0 ? (
                      <div className="relative border-l border-white/5/60 pl-5 space-y-5 ml-2">
                        {extractedData.timeline.map((event: any, idx: number) => (
                          <div key={idx} className="relative group">
                            <span className="absolute -left-[24px] top-1.5 h-2 w-2 rounded-full bg-blue-500 border border-slate-900 group-hover:scale-125 transition-transform" />
                            <span className="text-xs font-bold text-indigo-600 font-mono block">{event.date}</span>
                            <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{event.event}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic">No chronological dates or events extracted.</p>
                    )}
                  </div>
                )}

                {/* STATUTE EXPLORER SUBTAB */}
                {leftTab === 'statutes' && (
                  <div className="space-y-6 flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Statute Explorer (Indian Case Dataset)</h4>
                      
                      {/* Search Form */}
                      <form onSubmit={handleStatuteSearch} className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-[#1C1C1F] border border-white/5 rounded-xl mb-6">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Governing Act</label>
                          <select
                            value={statuteAct}
                            onChange={(e) => setStatuteAct(e.target.value)}
                            className="bg-[#0D111E] border border-white/5/60 rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 focus:outline-none focus:border-blue-500"
                          >
                            <option value="Indian Penal Code">Indian Penal Code (IPC)</option>
                            <option value="Code of Criminal Procedure">Code of Criminal Procedure (CrPC)</option>
                            <option value="">All Statutes</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Section Number</label>
                          <input
                            type="text"
                            value={statuteSection}
                            onChange={(e) => setStatuteSection(e.target.value)}
                            placeholder="e.g. 420, 406"
                            className="bg-[#0D111E] border border-white/5/60 rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Keyword search</label>
                          <input
                            type="text"
                            value={statuteKeyword}
                            onChange={(e) => setStatuteKeyword(e.target.value)}
                            placeholder="e.g. Cheating, trust, bail"
                            className="bg-[#0D111E] border border-white/5/60 rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            type="submit"
                            disabled={statuteLoading}
                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/60 text-sm font-bold text-white rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-blue-900/20"
                          >
                            {statuteLoading ? (
                              <span className="animate-spin h-3.5 w-3.5 border border-white border-t-transparent rounded-full" />
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                              </svg>
                            )}
                            Search Dataset
                          </button>
                        </div>
                      </form>

                      {/* Display Results */}
                      {statuteResults ? (
                        <div className="space-y-6">
                          {/* Stat Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="p-4 bg-[#1C1C1F] border border-white/5 rounded-xl text-center flex flex-col justify-center">
                              <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider mb-1">Total Matching Cases</span>
                              <strong className="text-2xl text-indigo-600 font-serif font-black">{statuteResults.total_cases}</strong>
                            </div>
                            <div className="p-4 bg-[#1C1C1F] border border-white/5 rounded-xl">
                              <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider mb-2">Outcome Metrics</span>
                              <div className="space-y-1 text-xs">
                                {Object.entries(statuteResults.outcome_counts || {}).map(([outcome, count]: [string, any]) => {
                                  const total = statuteResults.total_cases || 1;
                                  const pct = Math.round((count / total) * 100);
                                  return (
                                    <div key={outcome} className="flex flex-col gap-0.5">
                                      <div className="flex justify-between font-semibold">
                                        <span className="text-slate-500">{outcome}</span>
                                        <span className="text-slate-500">{count} ({pct}%)</span>
                                      </div>
                                      <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${outcome === 'Allowed' || outcome === 'Quashed' ? 'bg-emerald-500' : outcome === 'Dismissed' ? 'bg-red-500' : 'bg-blue-500'}`}
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                                {Object.keys(statuteResults.outcome_counts || {}).length === 0 && (
                                  <span className="text-slate-500 italic text-xs">No outcome data.</span>
                                )}
                              </div>
                            </div>
                            <div className="p-4 bg-[#1C1C1F] border border-white/5 rounded-xl text-xs">
                              <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider mb-2">Jurisdiction Profile</span>
                              {statuteResults.common_courts && statuteResults.common_courts.length > 0 ? (
                                <ul className="list-disc list-inside text-slate-300 space-y-0.5 text-xs">
                                  {statuteResults.common_courts.map((court: string, idx: number) => (
                                    <li key={idx} className="truncate">{court}</li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-slate-500 italic">No courts recorded.</span>
                              )}
                            </div>
                          </div>

                          {/* Cases and Details Split View */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/5">
                            <div className="flex flex-col">
                              <div className="flex justify-between items-center mb-3">
                                <span className="text-sm font-bold text-slate-300 uppercase tracking-widest">Case Records ({statuteResults.cases.length})</span>
                                {statuteResults.total_cases > 0 && (
                                  <button
                                    onClick={() => {
                                      // Load all cases as grounding context in chatbot
                                      const combinedContext = statuteResults.cases.slice(0, 3).map((c: any, i: number) => 
                                        `[Dataset Case ${i+1}: ${c.citation}]\nTitle: ${c.petitioner} vs. ${c.respondent}\nOutcome: ${c.outcome}\nFacts: ${c.case_facts}\nOutcome Reason: ${c.judgment_reason}`
                                      ).join("\n\n---\n\n");
                                      setChatbotSource('dataset');
                                      setLawyerChatMessages(prev => [
                                        ...prev,
                                        {
                                          sender: 'assistant',
                                          text: `Grounded in ${Math.min(3, statuteResults.cases.length)} cases matching Section/Act filters from the dataset. What details would you like to analyze?`
                                        }
                                      ]);
                                    }}
                                    className="text-xs bg-blue-600/10 hover:bg-blue-600/20 text-indigo-600 border border-blue-500/20 px-2 py-1 rounded transition-colors"
                                  >
                                    Ground Chat in these Cases
                                  </button>
                                )}
                              </div>
                              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                                {statuteResults.cases.map((c: any, idx: number) => (
                                  <div
                                    key={idx}
                                    onClick={() => setSelectedStatuteCase(c)}
                                    className={`p-3 border rounded-lg cursor-pointer transition-all hover:bg-slate-100/30 ${selectedStatuteCase?.case_id === c.case_id ? 'border-blue-500 bg-[#0A0D16]' : 'border-white/5/60 bg-[#121214]'}`}
                                  >
                                    <div className="flex justify-between items-start gap-2 mb-1">
                                      <span className="text-sm font-bold text-slate-200 truncate">{c.petitioner} vs. {c.respondent}</span>
                                      <span className={`text-xs px-1.5 py-0.5 rounded font-bold uppercase ${c.outcome === 'Allowed' || c.outcome === 'Quashed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                        {c.outcome}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs text-slate-500 font-mono">
                                      <span>{c.citation}</span>
                                      <span>{c.section_no_title}</span>
                                    </div>
                                  </div>
                                ))}
                                {statuteResults.cases.length === 0 && (
                                  <p className="text-xs text-slate-500 italic text-center py-6">No cases match the query criteria.</p>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col bg-[#121214] border border-white/5/60 rounded-xl p-4 min-h-[300px] max-h-[340px] overflow-y-auto">
                              {selectedStatuteCase ? (
                                <div className="space-y-4 text-sm">
                                  <div>
                                    <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider">Case Title & Citation</span>
                                    <h5 className="text-xs font-bold text-indigo-600 mt-0.5">{selectedStatuteCase.petitioner} vs. {selectedStatuteCase.respondent}</h5>
                                    <span className="text-xs font-mono text-slate-500 mt-1 block">{selectedStatuteCase.citation} • {selectedStatuteCase.court_name}</span>
                                  </div>
                                  <div>
                                    <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider">Statute Charge</span>
                                    <span className="text-amber-400 font-semibold">{selectedStatuteCase.act_name} — {selectedStatuteCase.section_no_title}</span>
                                  </div>
                                  <div>
                                    <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider">Facts Summary</span>
                                    <p className="text-slate-300 mt-1 leading-relaxed whitespace-pre-wrap">{selectedStatuteCase.case_facts}</p>
                                  </div>
                                  <div>
                                    <span className="text-xs text-slate-500 block uppercase font-bold tracking-wider">Outcome & Reasoning</span>
                                    <p className="text-slate-300 mt-1 leading-relaxed"><strong className="text-slate-200">Outcome:</strong> {selectedStatuteCase.outcome}</p>
                                    <p className="text-slate-300 mt-1 leading-relaxed"><strong className="text-slate-200">Reasoning:</strong> {selectedStatuteCase.judgment_reason}</p>
                                  </div>
                                  <div>
                                    <button
                                      onClick={() => {
                                        setChatInput(`Analyze case citation ${selectedStatuteCase.citation} from the dataset under ${selectedStatuteCase.section_no_title}. What are its key implications?`);
                                        setChatbotSource('dataset');
                                      }}
                                      className="py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white rounded transition-colors shadow"
                                    >
                                      Ask AI about this specific Case
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex-1 flex items-center justify-center text-slate-500 italic text-xs text-center">
                                  Select a case from the list on the left to examine details, facts, and judgment reasoning.
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-12 text-slate-500 italic text-xs">
                          Enter Act and Section filters above and click "Search Dataset" to view matching precedents, outcome metrics, and case sheets.
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>

          {/* LAWYER RIGHT COLUMN: AI Q&A Chatbot */}
          <div className="lg:col-span-5 flex flex-col">
            <div className="glass-panel flex-col h-[650px] lg:h-full flex justify-between overflow-hidden">

              {/* Chat Header */}
              <div className="p-5 bg-[#1C1C1F] border-b border-white/5 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-white text-xs uppercase tracking-wider">AI Legal Research Assistant</h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">Grounded RAG analysis engine</p>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-[#1C1C1F] border border-white/5 rounded-full shadow-inner">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs text-slate-500 font-mono font-bold uppercase">RAG Active</span>
                </div>
              </div>

              {/* Grounding Source Control */}
              <div className="px-5 py-2.5 bg-[#121214]/50 border-b border-white/5 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 font-semibold uppercase tracking-wider">Grounding:</span>
                  <div className="flex bg-[#1C1C1F] border border-white/5 rounded-md p-0.5">
                    <button
                      type="button"
                      onClick={() => setChatbotSource('document')}
                      className={`px-2.5 py-1 rounded text-xs font-bold tracking-wide transition-all ${chatbotSource === 'document' ? 'bg-blue-600/90 text-white' : 'text-slate-500 hover:text-slate-200'}`}
                    >
                      Case File
                    </button>
                    <button
                      type="button"
                      onClick={() => setChatbotSource('dataset')}
                      className={`px-2.5 py-1 rounded text-xs font-bold tracking-wide transition-all ${chatbotSource === 'dataset' ? 'bg-blue-600/90 text-white' : 'text-slate-500 hover:text-slate-200'}`}
                    >
                      Dataset (RAG)
                    </button>
                    <button
                      type="button"
                      onClick={() => setChatbotSource('combined')}
                      className={`px-2.5 py-1 rounded text-xs font-bold tracking-wide transition-all ${chatbotSource === 'combined' ? 'bg-blue-600/90 text-white' : 'text-slate-500 hover:text-slate-200'}`}
                    >
                      Combined (File & RAG)
                    </button>
                  </div>
                </div>

                {chatbotSource !== 'document' && (
                  <button
                    type="button"
                    onClick={handleRebuildIndex}
                    disabled={ragIndexBuilding}
                    className="px-2.5 py-1 bg-[#0A0D16] hover:bg-slate-900 border border-white/5/60 rounded text-sm font-bold text-slate-100 transition-all flex items-center gap-1 hover:text-slate-100 disabled:opacity-50"
                  >
                    {ragIndexBuilding ? (
                      <span className="animate-spin h-2.5 w-2.5 border border-slate-350 border-t-transparent rounded-full" />
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-3 h-3 text-slate-500">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                    )}
                    Rebuild RAG Index
                  </button>
                )}
              </div>

              {/* Chat Message Box */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {lawyerChatMessages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                    <div
                      className={`max-w-[85%] p-4 rounded-xl text-xs leading-relaxed shadow-md ${msg.sender === 'user'
                          ? 'bg-blue-600/10 border border-blue-500/20 text-slate-200'
                          : 'bg-[#0E1220]/70 border border-white/5/60 text-slate-300'
                        }`}
                    >
                      <p className="whitespace-pre-wrap font-sans">{msg.text}</p>

                      {msg.structuredResponse && msg.structuredResponse.ipc_sections && msg.structuredResponse.ipc_sections.length > 0 && (
                        <div className="mt-4 pt-3.5 border-t border-white/5 space-y-2">
                          <span className="text-xs text-slate-500 font-bold block uppercase tracking-wider">Statutory Provisions Map:</span>
                          {msg.structuredResponse.ipc_sections.map((ipc: any, sIdx: number) => (
                            <div key={sIdx} className="p-2.5 bg-[#1C1C1F] border border-white/5 rounded-lg">
                              <span className="text-xs font-bold text-amber-400">{ipc.section}: {ipc.title}</span>
                              <p className="text-xs text-slate-500 mt-0.5 leading-normal">{ipc.description}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.structuredResponse && msg.structuredResponse.pro_tip && (
                        <div className="mt-3 p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-xs text-indigo-400/90 leading-relaxed font-sans">
                          <span className="font-bold block text-xs uppercase tracking-wider mb-0.5">PRO CEDURAL RECOMMENDATION</span>
                          {msg.structuredResponse.pro_tip}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex items-center gap-2.5 text-xs text-slate-500 font-medium">
                    <span className="animate-spin h-3.5 w-3.5 border-2 border-slate-500 border-t-transparent rounded-full" />
                    Querying legal embeddings corpus...
                  </div>
                )}
              </div>

              {/* Chat Input & Prompts */}
              <div className="bg-[#1C1C1F]/[0.01] border-t border-white/5 p-4 space-y-3">

                {/* Prompts list */}
                <div className="flex flex-wrap gap-1.5">
                  {lawyerPrompts.map((link, idx) => (
                    <button
                      key={idx}
                      onClick={() => setChatInput(link.prompt)}
                      className="text-xs bg-[#0E1220] hover:bg-slate-900 border border-white/5/60 px-2.5 py-1 rounded-lg text-slate-500 hover:text-slate-200 transition-colors"
                    >
                      {link.title}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleChatSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Query statutes, case facts, or legal briefs..."
                    className="flex-1 bg-[#1C1C1F] border border-white/5 rounded-lg px-3 py-2.5 text-sm text-slate-300 font-medium focus:outline-none focus:border-blue-600 transition-colors placeholder:text-slate-500"
                    disabled={chatLoading}
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatInput.trim()}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/60 text-sm font-bold text-white rounded-lg transition-colors shadow-lg shadow-blue-900/20"
                  >
                    Query
                  </button>
                </form>
              </div>

            </div>
          </div>

        </main>
      ) : (

        /* ==================== CLIENT PORTAL ==================== */
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 p-8 max-w-[1700px] w-full mx-auto animate-fade-in">

          {/* CLIENT LEFT COLUMN: active case selector, Case Status Stepper, details, simplified summary */}
          <div className="lg:col-span-7 flex flex-col gap-6">

            {/* Case Selection Sidebar Panel */}
            <div className="glass-panel p-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-sm font-bold text-slate-300 uppercase tracking-widest block">My Case Profile</label>
                <select
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className="bg-[#0A0D16] border border-white/5/60 rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  {documents.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.filename}
                    </option>
                  ))}
                </select>
              </div>

              {/* Upload Document for Lawyer */}
              <div className="flex flex-col gap-1 justify-end">
                <span className="text-sm font-bold text-slate-300 uppercase tracking-widest block">Upload New Files</span>
                <label className="bg-[#1C1C1F] hover:bg-slate-100 border border-white/5 shadow-sm rounded-lg px-4 py-2 text-xs font-bold text-slate-300 text-center cursor-pointer transition-colors flex items-center justify-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4 text-slate-500">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                  </svg>
                  Submit Docs to Lawyer
                  <input type="file" onChange={handleFileUpload} accept=".pdf,.png,.jpg,.jpeg" className="hidden" disabled={actionLoading} />
                </label>
              </div>
            </div>

            {/* Stepper Progress Tracker */}
            <div className="glass-panel p-8 flex flex-col gap-6">
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Case Progression Tracker</h4>
                <p className="text-xs text-slate-500 font-medium">Real-time status of legal milestones and filings.</p>
              </div>

              {/* Progress Steps UI */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-2 pt-2">
                {statuses.map((st, idx) => {
                  const activeIdx = getStatusIndex(activeStatus);
                  const isCompleted = idx < activeIdx;
                  const isActive = idx === activeIdx;

                  return (
                    <React.Fragment key={st}>
                      {/* Step Indicator */}
                      <div className="flex flex-col items-center flex-1 text-center w-full sm:w-auto">
                        <div className={`step-bullet ${isCompleted ? 'bg-emerald-600/90 text-white' :
                            isActive ? 'bg-blue-600 text-white ring-4 ring-blue-500/20' :
                              'bg-[#0E1325] border border-white/10 text-slate-500'
                          }`}>
                          {isCompleted ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-3.5 h-3.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                          ) : idx + 1}
                        </div>
                        <span className={`text-xs font-bold tracking-wide uppercase mt-2.5 ${isActive ? 'text-indigo-600' : isCompleted ? 'text-slate-300' : 'text-slate-500'}`}>
                          {st === 'OCR Parsing' ? 'Case Intake' : st}
                        </span>
                        <span className="text-[8.5px] text-slate-500 mt-0.5">
                          {idx === 0 ? 'Document Processing' :
                            idx === 1 ? 'Attorney Evaluation' :
                              idx === 2 ? 'Hearing Calendared' : 'Matter Concluded'}
                        </span>
                      </div>

                      {/* Connection Line */}
                      {idx < statuses.length - 1 && (
                        <div className={`step-line hidden sm:block ${idx < activeIdx ? 'bg-emerald-600' : 'bg-white/10'
                          }`} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* Case Parameters Card Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

              {/* Professional Representation Card */}
              <div className="glass-panel p-5 space-y-4">
                <span className="text-sm font-bold text-slate-300 uppercase tracking-widest block">Legal Counsel</span>
                {extractedData && extractedData.lawyers && extractedData.lawyers.length > 0 ? (
                  <div className="space-y-3">
                    {extractedData.lawyers.map((lawyer: string, index: number) => (
                      <div key={index} className="flex items-center gap-3">
                        <div className="h-8 w-8 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 flex items-center justify-center rounded-full font-bold text-xs">
                          {lawyer.charAt(0)}
                        </div>
                        <div>
                          <h6 className="text-sm font-bold text-slate-100">{lawyer}</h6>
                          <span className="text-xs text-slate-500 font-semibold block uppercase">Advocate representing you</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No counsel assigned yet.</p>
                )}
              </div>

              {/* Court Jurisdiction Card */}
              <div className="glass-panel p-5 space-y-4">
                <span className="text-sm font-bold text-slate-300 uppercase tracking-widest block">Tribunal & Bench</span>
                {extractedData && extractedData.courts && extractedData.courts.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-500">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" />
                      </svg>
                      <h6 className="text-sm font-bold text-slate-100">{extractedData.courts[0]}</h6>
                    </div>
                    {extractedData.judges && extractedData.judges.length > 0 && (
                      <div className="text-[9.5px] text-slate-500 font-medium leading-relaxed pl-7">
                        Presiding: <span className="text-indigo-400 font-semibold">{extractedData.judges.join(', ')}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">Court jurisdiction not set.</p>
                )}
              </div>

              {/* Charged IPC Statutes Card */}
              <div className="glass-panel p-5 space-y-4">
                <span className="text-sm font-bold text-slate-300 uppercase tracking-widest block">Associated Statutes</span>
                {extractedData && extractedData.ipc_sections && extractedData.ipc_sections.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {extractedData.ipc_sections.map((ipc: string, index: number) => (
                      <span
                        key={index}
                        className="text-xs px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold uppercase tracking-wide"
                      >
                        {ipc}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No statutory sections detected.</p>
                )}
              </div>

            </div>

            {/* Case Summary Panel */}
            <div className="glass-panel p-6 space-y-4 flex-1">
              <div>
                <span className="text-sm font-bold text-slate-300 uppercase tracking-widest block mb-1">Case Facts Summary</span>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Factual background and events</h4>
              </div>
              <div className="p-4 bg-[#121214] border border-white/5 rounded-xl leading-relaxed text-xs text-slate-300 space-y-3 font-sans">
                <p>
                  This case represents an ongoing legal dispute registered in connection with the uploaded filings. The main items of record are as follows:
                </p>
                {extractedData && extractedData.timeline && extractedData.timeline.length > 0 ? (
                  <div className="space-y-2 pt-2">
                    <span className="text-xs font-bold uppercase text-indigo-600 block tracking-wider">Chronological Benchmarks:</span>
                    {extractedData.timeline.map((ev: any, i: number) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-slate-500 font-mono font-bold text-xs">{ev.date}:</span>
                        <span className="text-slate-300 font-medium">{ev.event}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 italic">Timeline events parsing is active. Ask the AI Legal Guide below for a simplified case layout.</p>
                )}
              </div>
            </div>

          </div>

          {/* CLIENT RIGHT COLUMN: AI client-friendly chatbot */}
          <div className="lg:col-span-5 flex flex-col">
            <div className="glass-panel flex-col h-[650px] lg:h-full flex justify-between overflow-hidden">

              {/* Chat Header */}
              <div className="p-5 bg-[#1C1C1F] border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 bg-emerald-950/40 border border-emerald-900/30 flex items-center justify-center rounded-lg shadow-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-emerald-400">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-xs uppercase tracking-wider">AI Client Legal Guide</h3>
                    <p className="text-xs text-slate-500 mt-0.5 font-medium">Simplified answers in plain terms</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-[#1C1C1F] border border-white/5 rounded-full shadow-inner">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs text-slate-500 font-mono font-bold uppercase">Online</span>
                </div>
              </div>

              {/* Grounding Source Control */}
              <div className="px-5 py-2.5 bg-[#121214]/50 border-b border-white/5 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 font-semibold uppercase tracking-wider">Grounding:</span>
                  <div className="flex bg-[#1C1C1F] border border-white/5 rounded-md p-0.5">
                    <button
                      type="button"
                      onClick={() => setChatbotSource('document')}
                      className={`px-2.5 py-1 rounded text-xs font-bold tracking-wide transition-all ${chatbotSource === 'document' ? 'bg-emerald-600/90 text-white' : 'text-slate-500 hover:text-slate-200'}`}
                    >
                      Case File
                    </button>
                    <button
                      type="button"
                      onClick={() => setChatbotSource('dataset')}
                      className={`px-2.5 py-1 rounded text-xs font-bold tracking-wide transition-all ${chatbotSource === 'dataset' ? 'bg-emerald-600/90 text-white' : 'text-slate-500 hover:text-slate-200'}`}
                    >
                      Dataset (RAG)
                    </button>
                    <button
                      type="button"
                      onClick={() => setChatbotSource('combined')}
                      className={`px-2.5 py-1 rounded text-xs font-bold tracking-wide transition-all ${chatbotSource === 'combined' ? 'bg-emerald-600/90 text-white' : 'text-slate-500 hover:text-slate-200'}`}
                    >
                      Combined (File & RAG)
                    </button>
                  </div>
                </div>

                {chatbotSource !== 'document' && (
                  <button
                    type="button"
                    onClick={handleRebuildIndex}
                    disabled={ragIndexBuilding}
                    className="px-2.5 py-1 bg-[#0A0D16] hover:bg-slate-900 border border-white/5/60 rounded text-sm font-bold text-slate-300 transition-all flex items-center gap-1 hover:text-slate-100 disabled:opacity-50"
                  >
                    {ragIndexBuilding ? (
                      <span className="animate-spin h-2.5 w-2.5 border border-slate-350 border-t-transparent rounded-full" />
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-3 h-3 text-slate-500">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                    )}
                    Rebuild RAG Index
                  </button>
                )}
              </div>

              {/* Chat Messages Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {clientChatMessages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                    <div
                      className={`max-w-[85%] p-4 rounded-xl text-xs leading-relaxed shadow-md ${msg.sender === 'user'
                          ? 'bg-emerald-600/10 border border-emerald-500/20 text-emerald-400'
                          : 'bg-[#0E1220]/70 border border-white/5/60 text-slate-300'
                        }`}
                    >
                      <p className="whitespace-pre-wrap font-sans font-medium">{msg.text}</p>

                      {msg.structuredResponse && msg.structuredResponse.explanation && (
                        <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                          <span className="text-xs text-slate-500 font-bold block uppercase tracking-wider">What this means for you:</span>
                          <p className="text-slate-300 font-sans leading-relaxed">{msg.structuredResponse.explanation}</p>
                        </div>
                      )}

                      {msg.structuredResponse && msg.structuredResponse.pro_tip && (
                        <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400 font-sans leading-relaxed">
                          <span className="font-bold block text-xs uppercase tracking-wider mb-0.5">NEXT STEPS FOR YOU</span>
                          {msg.structuredResponse.pro_tip}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex items-center gap-2.5 text-xs text-slate-500 font-medium">
                    <span className="animate-spin h-3.5 w-3.5 border-2 border-slate-500 border-t-transparent rounded-full" />
                    AI Guide is simplifying terms for you...
                  </div>
                )}
              </div>

              {/* Chat Inputs & Client presets */}
              <div className="bg-[#1C1C1F]/[0.01] border-t border-white/5 p-4 space-y-3">

                {/* Client presets */}
                <div className="flex flex-wrap gap-1.5">
                  {clientPrompts.map((link, idx) => (
                    <button
                      key={idx}
                      onClick={() => setChatInput(link.prompt)}
                      className="text-xs bg-[#0E1220] hover:bg-slate-900 border border-white/5/60 px-2.5 py-1 rounded-lg text-slate-500 hover:text-slate-200 transition-colors"
                    >
                      {link.title}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleChatSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask standard questions about your case details..."
                    className="flex-1 bg-[#1C1C1F] border border-white/5 rounded-lg px-3 py-2.5 text-sm text-slate-300 font-medium focus:outline-none focus:border-emerald-600 transition-colors placeholder:text-slate-500"
                    disabled={chatLoading}
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatInput.trim()}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900/60 text-sm font-bold text-white rounded-lg transition-colors shadow-lg shadow-emerald-900/20"
                  >
                    Query
                  </button>
                </form>
              </div>

            </div>
          </div>

        </main>
      )}

      {/* FOOTER NOTICE */}
      <footer className="bg-[#05070E] border-t border-white/5 p-5 text-center text-xs text-slate-500 leading-normal font-medium tracking-wide">
        Privileged Attorney-Client Work Product. Grounded in Active Litigation Files. Powered by AI legal Agent Legal Assistant.
      </footer>
    </div>
  );
};
