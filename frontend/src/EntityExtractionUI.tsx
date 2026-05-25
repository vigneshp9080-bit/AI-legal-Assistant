import React, { useState, useEffect } from 'react';

// Define Types for Extracted Entities
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

interface EntityExtractionResponse {
  document_id: string;
  judges: string[];
  lawyers: string[];
  ipc_sections: string[];
  fir_numbers: string[];
  courts: string[];
  companies: string[];
  organizations: string[];
  persons: string[];
  locations: string[];
  dates: string[];
  case_numbers: string[];
  raw_entities: EntityItem[];
  relationships: RelationshipItem[];
  timeline: TimelineEvent[];
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

export const EntityExtractionUI: React.FC = () => {
  // Navigation tabs state
  const [leftTab, setLeftTab] = useState<'upload' | 'chatbot'>('upload');
  const [rightTab, setRightTab] = useState<'entities' | 'graph' | 'intelligence'>('entities');

  // Input states
  const [documentText, setDocumentText] = useState<string>(
    "IN THE HIGH COURT OF DELHI AT NEW DELHI\n" +
    "Writ Petition No. 1024 of 2024\n\n" +
    "BEFORE: Hon'ble Mr. Justice Sanjay Kishan\n\n" +
    "In the matter of:\n" +
    "Apex Global Pvt Ltd ... Petitioner\n" +
    "Versus\n" +
    "Union of India & Ors. ... Respondents\n\n" +
    "Advocate Ramesh Kumar appeared for the Petitioner.\n" +
    "Counsel Sneha Gupta appeared for the Respondents.\n\n" +
    "JUDGMENT:\n" +
    "1. The Petitioner has filed this petition challenging the action of the respondents in connection with FIR No. 445/2023 registered at New Delhi Police Station under Section 406 and Section 420 of the Indian Penal Code (IPC) for alleged breach of contract and cheating."
  );

  const [extractedData, setExtractedData] = useState<EntityExtractionResponse>({
    document_id: "doc-9b1c7d2e-4b6a-4c2d",
    judges: ["Justice Sanjay Kishan"],
    lawyers: ["Ramesh Kumar", "Sneha Gupta"],
    ipc_sections: ["Section 406", "Section 420"],
    fir_numbers: ["FIR No. 445/2023"],
    courts: ["Delhi High Court"],
    companies: ["Apex Global Pvt Ltd"],
    organizations: ["Union of India"],
    persons: [],
    locations: ["New Delhi"],
    dates: ["2024"],
    case_numbers: ["Writ Petition No. 1024 of 2024"],
    raw_entities: [
      { entity_type: "courts", entity_value: "Delhi High Court", confidence_score: 0.95 },
      { entity_type: "case_numbers", entity_value: "Writ Petition No. 1024 of 2024", confidence_score: 0.95 },
      { entity_type: "judges", entity_value: "Justice Sanjay Kishan", confidence_score: 0.90 },
      { entity_type: "companies", entity_value: "Apex Global Pvt Ltd", confidence_score: 0.85 },
      { entity_type: "organizations", entity_value: "Union of India", confidence_score: 0.80 },
      { entity_type: "lawyers", entity_value: "Ramesh Kumar", confidence_score: 0.90 },
      { entity_type: "lawyers", entity_value: "Sneha Gupta", confidence_score: 0.90 },
      { entity_type: "fir_numbers", entity_value: "FIR No. 445/2023", confidence_score: 0.98 },
      { entity_type: "ipc_sections", entity_value: "Section 406", confidence_score: 0.95 },
      { entity_type: "ipc_sections", entity_value: "Section 420", confidence_score: 0.95 }
    ],
    relationships: [
      { source: "Ramesh Kumar", target: "Apex Global Pvt Ltd", type: "REPRESENTS" },
      { source: "Sneha Gupta", target: "Union of India", type: "REPRESENTS" },
      { source: "Justice Sanjay Kishan", target: "Delhi High Court", type: "PRESIDES_OVER" }
    ],
    timeline: [
      { date: "2023", event: "FIR No. 445/2023 registered at New Delhi Police Station under Section 406 and Section 420 of the IPC" },
      { date: "2024", event: "Writ Petition No. 1024 of 2024 filed before Hon'ble Mr. Justice Sanjay Kishan" }
    ]
  });

  const [similarCases, setSimilarCases] = useState<SimilarCase[]>([
    {
      title: "State of Maharashtra vs. Kalyan Industrial Corp",
      citation: "2022 SCC Online Bom 1402",
      court: "Bombay High Court",
      summary: "Case examining criminal breach of trust (Section 406) in high-value commercial agreements and rules governing commercial arbitrations."
    },
    {
      title: "Radheshyam Khemka vs. State of Bihar",
      citation: "(1993) 1 SCC 285",
      court: "Supreme Court of India",
      summary: "Benchmark judgment determining when breach of contract manifests criminal intent of cheating under Section 420 of the IPC."
    }
  ]);

  // Chatbot states
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      sender: 'assistant',
      text: "Hello! I am your AI Indian Legal Assistant. You can upload a case file above or ask me any legal query. Try asking: 'What are the implications of Section 420 IPC?'"
    }
  ]);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatLoading, setChatLoading] = useState<boolean>(false);

  // Upload/Processing states
  const [loading, setLoading] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [selectedEntity, setSelectedEntity] = useState<EntityItem | null>(null);

  // SVG Node Coordinates for Knowledge Graph
  const [graphNodes, setGraphNodes] = useState<any[]>([]);
  const [graphLinks, setGraphLinks] = useState<any[]>([]);

  // Category Color Map
  const entityColors: Record<string, { bg: string; border: string; text: string; badge: string; colorHex: string }> = {
    judges: { bg: 'rgba(239, 68, 68, 0.08)', border: 'border-red-500/20', text: 'text-red-400', badge: 'bg-red-500/10 text-red-300', colorHex: '#EF4444' },
    lawyers: { bg: 'rgba(59, 130, 246, 0.08)', border: 'border-blue-500/20', text: 'text-blue-400', badge: 'bg-blue-500/10 text-blue-300', colorHex: '#3B82F6' },
    ipc_sections: { bg: 'rgba(245, 158, 11, 0.08)', border: 'border-amber-500/20', text: 'text-amber-400', badge: 'bg-amber-500/10 text-amber-300', colorHex: '#F59E0B' },
    courts: { bg: 'rgba(168, 85, 247, 0.08)', border: 'border-purple-500/20', text: 'text-purple-400', badge: 'bg-purple-500/10 text-purple-300', colorHex: '#A855F7' },
    companies: { bg: 'rgba(16, 185, 129, 0.08)', border: 'border-emerald-500/20', text: 'text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-300', colorHex: '#10B981' },
    fir_numbers: { bg: 'rgba(236, 72, 153, 0.08)', border: 'border-pink-500/20', text: 'text-pink-400', badge: 'bg-pink-500/10 text-pink-300', colorHex: '#EC4899' },
    case_numbers: { bg: 'rgba(6, 182, 212, 0.08)', border: 'border-cyan-500/20', text: 'text-cyan-400', badge: 'bg-cyan-500/10 text-cyan-300', colorHex: '#06B6D4' },
    organizations: { bg: 'rgba(107, 114, 128, 0.08)', border: 'border-gray-500/20', text: 'text-gray-400', badge: 'bg-gray-500/10 text-gray-300', colorHex: '#6B7280' },
    persons: { bg: 'rgba(99, 102, 241, 0.08)', border: 'border-indigo-500/20', text: 'text-indigo-400', badge: 'bg-indigo-500/10 text-indigo-300', colorHex: '#6366F1' },
    locations: { bg: 'rgba(20, 184, 166, 0.08)', border: 'border-teal-500/20', text: 'text-teal-400', badge: 'bg-teal-500/10 text-teal-300', colorHex: '#14B8A6' },
    dates: { bg: 'rgba(14, 165, 233, 0.08)', border: 'border-sky-500/20', text: 'text-sky-400', badge: 'bg-sky-500/10 text-sky-300', colorHex: '#0EA5E9' }
  };

  // Re-generate Graph coordinates when extractedData updates
  useEffect(() => {
    const nodes: any[] = [];
    const nodeMap = new Map();
    let index = 0;

    const addNode = (id: string, type: string) => {
      if (!id) return;
      const key = `${type}-${id}`;
      if (!nodeMap.has(key)) {
        // Distribute nodes radially
        const angle = (index * 2 * Math.PI) / 8;
        const radius = 110 + (index % 2) * 35;
        const x = 230 + radius * Math.cos(angle);
        const y = 200 + radius * Math.sin(angle);
        const nodeObj = { id, type, x, y };
        nodeMap.set(key, nodeObj);
        nodes.push(nodeObj);
        index++;
      }
    };

    extractedData.judges?.forEach(n => addNode(n, 'judges'));
    extractedData.lawyers?.forEach(n => addNode(n, 'lawyers'));
    extractedData.ipc_sections?.forEach(n => addNode(n, 'ipc_sections'));
    extractedData.courts?.forEach(n => addNode(n, 'courts'));
    extractedData.companies?.forEach(n => addNode(n, 'companies'));
    extractedData.persons?.forEach(n => addNode(n, 'persons'));
    extractedData.fir_numbers?.forEach(n => addNode(n, 'fir_numbers'));

    const links = (extractedData.relationships || []).map(rel => {
      const sourceNode = nodes.find(n => n.id === rel.source);
      const targetNode = nodes.find(n => n.id === rel.target);
      return {
        source: sourceNode || { x: 100, y: 100 },
        target: targetNode || { x: 300, y: 300 },
        type: rel.type,
        sourceId: rel.source,
        targetId: rel.target
      };
    });

    setGraphNodes(nodes);
    setGraphLinks(links);
  }, [extractedData]);

  // Handle OCR + Entity Extraction via uploaded file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setUploadStatus("Uploading file & running OCR pipeline...");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("http://127.0.0.1:8000/api/analyze-document", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Upload failed. Status: ${res.status}`);
      }

      const data = await res.json();
      setDocumentText(data.entities.raw_entities.map((e: any) => e.context_text).join("\n") || "No raw text recovered.");
      setExtractedData(data.entities);
      setUploadStatus("Success: Case file analyzed.");
      
      // Pull similar cases based on primary case details
      fetchSimilarCases(file.name);
    } catch (err: any) {
      console.error(err);
      setUploadStatus(`Error: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchSimilarCases = async (queryText: string) => {
    try {
      const res = await fetch("http://127.0.0.1:8000/api/similar-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryText, k: 3 })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.length > 0) {
          setSimilarCases(data);
        }
      }
    } catch (e) {
      console.error("Failed to fetch similar case matches:", e);
    }
  };

  // Run entity extraction on manually typed raw text
  const triggerExtraction = async () => {
    setLoading(true);
    setUploadStatus("Analyzing custom text...");
    try {
      const res = await fetch('http://127.0.0.1:8000/api/extract-entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: documentText, filename: 'typed_input.txt' })
      });
      if (!res.ok) {
        throw new Error(`Server status: ${res.status}`);
      }
      const json = await res.json();
      setExtractedData(json);
      setUploadStatus("Analysis complete.");
      fetchSimilarCases(documentText.substring(0, 100));
    } catch (err: any) {
      console.error(err);
      setUploadStatus(`Extraction failed: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  // Chatbot Q&A
  const handleChatSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;

    const userQuery = chatInput;
    setChatMessages(prev => [...prev, { sender: 'user', text: userQuery }]);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch('http://127.0.0.1:8000/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userQuery })
      });

      if (!res.ok) {
        throw new Error(`Chat error status: ${res.status}`);
      }

      const data = await res.json();
      setChatMessages(prev => [...prev, {
        sender: 'assistant',
        text: data.direct_answer,
        structuredResponse: data
      }]);
    } catch (err: any) {
      console.error(err);
      setChatMessages(prev => [...prev, {
        sender: 'assistant',
        text: `Error contacting legal chatbot: ${err.message || err}`
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Pre-load a prompt in the chat input
  const loadChatPrompt = (prompt: string) => {
    setChatInput(prompt);
  };

  // Render text segments with highlighted spans
  const renderHighlightedText = () => {
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
      const styles = entityColors[match.entity.entity_type] || { bg: 'rgba(255,255,255,0.1)', border: 'border-white/10', text: 'text-white', badge: 'bg-white/10' };

      parts.push(
        <span
          key={`${match.start}-${match.entity.entity_value}`}
          onClick={() => setSelectedEntity(match.entity)}
          className={`cursor-pointer inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold transition-all duration-200 border hover:scale-105 ${styles.bg} ${styles.border} ${styles.text} mx-0.5`}
        >
          {match.entity.entity_value}
          <span className={`text-[9px] px-1 rounded-sm uppercase tracking-wider ${styles.badge}`}>
            {match.entity.entity_type.replace('_', ' ')}
          </span>
        </span>
      );
      currentIdx = match.end;
    });

    if (currentIdx < documentText.length) {
      parts.push(documentText.substring(currentIdx));
    }

    return <div className="whitespace-pre-wrap leading-relaxed text-gray-300 font-serif text-sm">{parts}</div>;
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 p-4 md:p-8 font-sans">
      {/* Header Banner */}
      <div className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <span className="text-[10px] font-extrabold text-blue-500 uppercase tracking-widest bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
            Adalat AI • Indian Case Law Assistant
          </span>
          <h1 className="text-2xl font-black tracking-tight text-white mt-1.5 flex items-center gap-2">
            AI Legal Assistant & Investigation Suite
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Conduct legal research, OCR case documents, query IPC guidelines, and map litigant networks.
          </p>
        </div>

        {/* Upload Control */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          <label className="px-4 py-2 bg-slate-850 hover:bg-slate-800 border border-slate-700 rounded-lg cursor-pointer text-xs font-medium text-slate-300 text-center transition-colors">
            Upload PDF / Image
            <input type="file" onChange={handleFileUpload} accept=".pdf,.png,.jpg,.jpeg" className="hidden" />
          </label>
          <button
            onClick={triggerExtraction}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-xs font-semibold rounded-lg shadow-lg hover:shadow-blue-500/20 transition-all duration-200 border border-blue-400/20 text-white flex items-center justify-center gap-2"
          >
            {loading ? <span className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" /> : null}
            Re-Analyze Text
          </button>
        </div>
      </div>

      {/* Progress Log Console */}
      {uploadStatus && (
        <div className="max-w-7xl mx-auto mb-6 p-2 px-4 bg-slate-900 border border-slate-800 rounded-lg flex justify-between items-center text-xs">
          <span className="text-slate-400 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-ping" />
            System status: <strong className="text-blue-400">{uploadStatus}</strong>
          </span>
          <button onClick={() => setUploadStatus('')} className="text-slate-500 hover:text-slate-300">Dismiss</button>
        </div>
      )}

      {/* Main Grid */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: UPLOAD / EDITING & CHATBOT */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          <div className="bg-[#1E293B]/80 backdrop-blur-md border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col min-h-[580px]">
            {/* Tab Header */}
            <div className="flex border-b border-slate-800 bg-[#1E293B]">
              <button
                onClick={() => setLeftTab('upload')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${leftTab === 'upload' ? 'border-blue-500 text-blue-400 bg-slate-900/50' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              >
                Case File & Text Editor
              </button>
              <button
                onClick={() => setLeftTab('chatbot')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${leftTab === 'chatbot' ? 'border-blue-500 text-blue-400 bg-slate-900/50' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              >
                Legal Assistant Chat
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 flex-1 flex flex-col">
              {leftTab === 'upload' ? (
                <div className="flex flex-col gap-5 flex-1 justify-between">
                  <div className="flex-1 flex flex-col">
                    <span className="text-[10px] text-slate-400 font-semibold mb-2 block uppercase tracking-wider">
                      OCR Document Text Output
                    </span>
                    <textarea
                      value={documentText}
                      onChange={(e) => setDocumentText(e.target.value)}
                      className="w-full flex-1 min-h-[300px] bg-[#0F172A] border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-300 focus:outline-none focus:border-blue-500/50 resize-none transition-colors"
                      placeholder="Paste legal case summary, police report or court filing text here..."
                    />
                  </div>

                  {/* FAISS Case Law Matches */}
                  <div className="pt-4 border-t border-slate-800/80">
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-widest mb-3">
                      Similar Case Law Match (FAISS RAG)
                    </h4>
                    <div className="space-y-3">
                      {similarCases.map((c, idx) => (
                        <div key={idx} className="p-3 bg-slate-900 border border-slate-800/85 rounded-lg hover:border-slate-700 transition-all">
                          <div className="flex justify-between items-start gap-2 mb-1">
                            <span className="text-xs font-extrabold text-blue-400">{c.title}</span>
                            <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">{c.citation}</span>
                          </div>
                          <span className="text-[10px] text-slate-500 block mb-1">{c.court}</span>
                          <p className="text-xs text-slate-400 leading-normal">{c.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 h-[450px]">
                  {/* Messages Feed */}
                  <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-4 scrollbar-thin">
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`p-3.5 rounded-lg text-xs max-w-[85%] leading-relaxed ${msg.sender === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none'}`}>
                          {msg.text}

                          {/* Render structured responses from backend models */}
                          {msg.structuredResponse && (
                            <div className="mt-4 pt-3 border-t border-slate-800 space-y-3 text-slate-300">
                              <div>
                                <span className="text-[9px] uppercase font-bold text-blue-400 block mb-0.5">EXPLANATION IN SIMPLE TERMS</span>
                                <p className="text-[11px] leading-relaxed">{msg.structuredResponse.explanation}</p>
                              </div>
                              {msg.structuredResponse.ipc_sections && msg.structuredResponse.ipc_sections.length > 0 && (
                                <div>
                                  <span className="text-[9px] uppercase font-bold text-amber-400 block mb-1">APPLICABLE INDIAN STATUTES</span>
                                  <div className="space-y-1.5">
                                    {msg.structuredResponse.ipc_sections.map((ipc, sIdx) => (
                                      <div key={sIdx} className="bg-slate-950 p-2 rounded border border-slate-800/80">
                                        <span className="font-bold text-[10px] text-amber-300 block">{ipc.section}: {ipc.title}</span>
                                        <p className="text-[10px] text-slate-400 mt-0.5">{ipc.description}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {msg.structuredResponse.pro_tip && (
                                <div className="bg-blue-500/10 p-2 rounded border border-blue-500/20">
                                  <span className="text-[9px] uppercase font-bold text-blue-400 block">PRO TIP</span>
                                  <p className="text-[10px] leading-relaxed text-slate-300 mt-0.5">{msg.structuredResponse.pro_tip}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="animate-spin h-3.5 w-3.5 border-2 border-slate-500 border-t-transparent rounded-full" />
                        AI Assistant is analyzing law books...
                      </div>
                    )}
                  </div>

                  {/* Preset prompt buttons */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <button onClick={() => loadChatPrompt("What legal issues exist in this case?")} className="text-[10px] bg-slate-900 hover:bg-slate-850 border border-slate-800 px-2 py-1 rounded text-slate-400 hover:text-slate-200">
                      Case Analysis
                    </button>
                    <button onClick={() => loadChatPrompt("Explain the penalties for Section 420 IPC.")} className="text-[10px] bg-slate-900 hover:bg-slate-850 border border-slate-800 px-2 py-1 rounded text-slate-400 hover:text-slate-200">
                      Explain Section 420
                    </button>
                    <button onClick={() => loadChatPrompt("What are the next actions to challenge this FIR?")} className="text-[10px] bg-slate-900 hover:bg-slate-850 border border-slate-800 px-2 py-1 rounded text-slate-400 hover:text-slate-200">
                      FIR Actions
                    </button>
                  </div>

                  {/* Message Input bar */}
                  <form onSubmit={handleChatSubmit} className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      className="flex-1 bg-[#0F172A] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50"
                      placeholder="Ask a legal query or question on case details..."
                    />
                    <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white">
                      Send
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: VISUAL INTELLIGENCE & CHARTS */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          <div className="bg-[#1E293B]/80 backdrop-blur-md border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col min-h-[580px]">
            {/* Tab Header */}
            <div className="flex border-b border-slate-800 bg-[#1E293B]">
              <button
                onClick={() => setRightTab('entities')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${rightTab === 'entities' ? 'border-blue-500 text-blue-400 bg-slate-900/50' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              >
                Entities & Timeline
              </button>
              <button
                onClick={() => setRightTab('graph')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${rightTab === 'graph' ? 'border-blue-500 text-blue-400 bg-slate-900/50' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              >
                Relational Graph
              </button>
              <button
                onClick={() => setRightTab('intelligence')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${rightTab === 'intelligence' ? 'border-blue-500 text-blue-400 bg-slate-900/50' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              >
                Investigation Intelligence
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 flex-1 flex flex-col overflow-y-auto scrollbar-thin max-h-[540px]">
              
              {/* ENTITIES AND TIMELINE VIEW */}
              {rightTab === 'entities' && (
                <div className="space-y-6">
                  {/* Highlighting Overlay */}
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-2">
                      Semantic Overlay Markup
                    </span>
                    <div className="p-4 bg-[#0F172A] rounded-lg border border-slate-800/80 min-h-[120px] max-h-[160px] overflow-y-auto scrollbar-thin">
                      {renderHighlightedText()}
                    </div>
                  </div>

                  {/* Grid Cards of Entities */}
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-2.5">
                      Extracted Entity Categorization
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.keys(entityColors).map((category) => {
                        const items = (extractedData as any)[category] as string[];
                        const styles = entityColors[category];
                        if (!items || items.length === 0) return null;

                        return (
                          <div
                            key={category}
                            className={`p-2.5 rounded-lg border bg-[#0F172A] hover:bg-[#0F172A]/80 transition-all ${styles.border}`}
                          >
                            <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-400 block mb-1.5">
                              {category.replace('_', ' ')}
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {items.map((val, idx) => (
                                <span
                                  key={idx}
                                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${styles.badge}`}
                                >
                                  {val}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Timeline Flow */}
                  {extractedData.timeline && extractedData.timeline.length > 0 && (
                    <div className="pt-2">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-3">
                        Case History Timeline (Date Sequence)
                      </span>
                      <div className="relative border-l border-slate-800 pl-4 ml-2 space-y-4">
                        {extractedData.timeline.map((event, idx) => (
                          <div key={idx} className="relative">
                            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-blue-500 border-2 border-[#1E293B]" />
                            <span className="text-xs font-bold text-blue-400 font-mono block">{event.date}</span>
                            <p className="text-xs text-slate-300 mt-0.5 leading-normal">{event.event}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* RELATIONAL KNOWLEDGE GRAPH */}
              {rightTab === 'graph' && (
                <div className="flex flex-col items-stretch flex-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-2">
                    Litigant Network Graph Visualizer
                  </span>
                  
                  <div className="relative w-full bg-[#0F172A] rounded-lg border border-slate-800 overflow-hidden flex items-center justify-center min-h-[300px]">
                    {graphNodes.length === 0 ? (
                      <div className="text-slate-500 text-xs">No graph relations detected. Please upload/run extraction.</div>
                    ) : (
                      <svg width="460" height="380" className="w-full max-h-[380px]">
                        {/* Define arrow marker */}
                        <defs>
                          <marker id="arrow" viewBox="0 0 10 10" refX="17" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                            <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
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
                              stroke="#334155"
                              strokeWidth="1.5"
                              markerEnd="url(#arrow)"
                            />
                            <text
                              x={(link.source.x + link.target.x) / 2}
                              y={(link.source.y + link.target.y) / 2 - 4}
                              fill="#64748B"
                              fontSize="8"
                              fontWeight="bold"
                              textAnchor="middle"
                              className="bg-[#0F172A]"
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
                                r="10"
                                fill={config.colorHex}
                                fillOpacity="0.25"
                                stroke={config.colorHex}
                                strokeWidth="2"
                              />
                              <circle
                                cx={node.x}
                                cy={node.y}
                                r="4"
                                fill={config.colorHex}
                              />
                              <text
                                x={node.x}
                                y={node.y - 14}
                                fill="#F1F5F9"
                                fontSize="9"
                                fontWeight="bold"
                                textAnchor="middle"
                              >
                                {node.id.length > 15 ? node.id.substring(0, 13) + '..' : node.id}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 mt-2 text-center">
                    Nodes represent case entities. Lines indicate extracted legal relationships. Click on any node to select it.
                  </span>
                </div>
              )}

              {/* INVESTIGATION INTELLIGENCE ASSESSMENT */}
              {rightTab === 'intelligence' && (
                <div className="space-y-4">
                  {/* Warning Cards */}
                  <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <span className="text-red-400 text-xs font-bold uppercase tracking-wide block mb-1">
                      Statutory Violations Identified
                    </span>
                    <p className="text-xs text-slate-300 leading-normal">
                      The analyzer matches sections of the Indian Penal Code:
                    </p>
                    <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside mt-2">
                      <li><strong className="text-amber-400">Section 406 IPC</strong>: Criminal Breach of Trust. Carries an imprisonment penalty of up to 3 years.</li>
                      <li><strong className="text-amber-400">Section 420 IPC</strong>: Cheating and dishonestly inducing delivery of property. Carries an imprisonment penalty of up to 7 years. Non-bailable offense.</li>
                    </ul>
                  </div>

                  {/* Recommendation card */}
                  <div className="p-3.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <span className="text-blue-400 text-xs font-bold uppercase tracking-wide block mb-1">
                      Actionable Roadmap
                    </span>
                    <ul className="text-xs text-slate-300 space-y-2 list-decimal list-inside mt-1.5">
                      <li>File a Quashing Petition under <strong className="text-blue-300">Section 482 CrPC</strong> before the High Court if no prima facie case is made out.</li>
                      <li>Secure anticipatory bail under <strong className="text-blue-300">Section 438 CrPC</strong> if arrest is apprehended under Section 420.</li>
                      <li>Verify dispatch of the mandatory <strong className="text-blue-300">Section 41A CrPC</strong> notice of appearance by the investigating officer.</li>
                    </ul>
                  </div>

                  {/* Pro tips card */}
                  <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
                    <span className="text-emerald-400 font-bold block mb-1 uppercase tracking-wider">Investigating Officer Warning</span>
                    <p className="text-slate-300 leading-normal">
                      Always record all communication history with investigators. If summoned, verify the summon orders are signed under proper authority.
                    </p>
                  </div>
                </div>
              )}

              {/* Selected Entity details panel */}
              {selectedEntity && (
                <div className="mt-6 bg-[#0F172A] border border-blue-500/30 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Active Selector Details</span>
                    <button onClick={() => setSelectedEntity(null)} className="text-[10px] text-slate-500 hover:text-slate-300">Close</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[9px] text-slate-500 block">NAME</span>
                      <strong className="text-white">{selectedEntity.entity_value}</strong>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 block">CATEGORY</span>
                      <strong className="text-slate-300 uppercase">{selectedEntity.entity_type.replace('_', ' ')}</strong>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
