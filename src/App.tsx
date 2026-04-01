import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HardDrive, Settings, Bot, Trash2, Search, AlertCircle, CheckCircle2, UserCircle2 } from "lucide-react";
import OpenAI from "openai";
import "./App.css";

type DiskInfo = {
  name: string;
  mount_point: string;
  total_space: number;
  available_space: number;
};

type FolderSize = {
  path: string;
  size_bytes: number;
};

type Persona = "programmer" | "office" | "ai_beginner" | "unknown";

const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// 探针配置：用于快速检测用户身份
const PROBES: Record<Persona, string[]> = {
  programmer: [
    "{home}/.npm",
    "{home}/.cargo",
    "{home}/.gradle",
    "{home}/.m2",
    "{home}/.rustup",
    "{home}/AppData/Local/Docker",
  ],
  office: [
    "{home}/Documents/Tencent Files",
    "{home}/Documents/WeChat Files",
    "{home}/Library/Containers/com.tencent.xinWeChat",
  ],
  ai_beginner: [
    "{home}/.cache/huggingface",
    "{home}/.ollama",
    "{home}/miniconda3",
    "{home}/anaconda3",
  ],
  unknown: [],
};

// 深度扫描目标
const PERSONA_PATHS: Record<Persona, string[]> = {
  programmer: [
    "{home}/.npm/_cacache",
    "{home}/.cargo/registry",
    "{home}/.gradle/caches",
    "{home}/.m2/repository",
    "{home}/Library/Containers/com.docker.docker",
    "{home}/AppData/Local/Docker",
  ],
  office: [
    "{home}/Downloads",
    "{home}/Documents/Tencent Files",
    "{home}/Documents/WeChat Files",
    "{home}/Library/Containers/com.tencent.xinWeChat",
    "{home}/Library/Containers/com.tencent.qq",
  ],
  ai_beginner: [
    "{home}/.cache/huggingface",
    "{home}/.ollama/models",
    "{home}/AppData/Local/pip/cache",
    "{home}/Library/Caches/pip",
    "{home}/miniconda3/pkgs",
    "{home}/anaconda3/pkgs",
  ],
  unknown: [
    "{home}/Downloads",
    "{home}/AppData/Local/Temp",
    "{home}/Library/Caches"
  ]
};

function App() {
  const [diskInfo, setDiskInfo] = useState<DiskInfo[]>([]);
  const [homeDir, setHomeDir] = useState<string>("");
  const [detectedPersona, setDetectedPersona] = useState<Persona>("unknown");
  const [results, setResults] = useState<FolderSize[]>([]);
  
  const [scanStatus, setScanStatus] = useState<"idle" | "probing" | "scanning" | "done">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  
  const [aiAdvice, setAiAdvice] = useState<string>("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  
  const [llmConfig, setLlmConfig] = useState({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-3.5-turbo",
  });
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const home: string = await invoke("get_home_dir");
        setHomeDir(home);
        const disks: DiskInfo[] = await invoke("get_disk_info");
        setDiskInfo(disks);
      } catch (e) {
        console.error("Failed to init", e);
      }
    }
    init();
  }, []);

  const handleScan = async () => {
    setScanStatus("probing");
    setResults([]);
    setAiAdvice("");
    
    // 阶段一：探针扫描，推断身份
    setStatusMessage("正在分析电脑使用习惯...");
    const scores: Record<Persona, number> = {
      programmer: 0,
      office: 0,
      ai_beginner: 0,
      unknown: 0
    };

    for (const [p, probes] of Object.entries(PROBES)) {
      const personaKey = p as Persona;
      for (const probe of probes) {
        const path = probe.replace("{home}", homeDir);
        try {
          const exists: boolean = await invoke("path_exists", { path });
          if (exists) scores[personaKey]++;
        } catch (e) {}
      }
    }

    // 找出得分最高的身份
    let maxScore = 0;
    let inferredPersona: Persona = "unknown";
    for (const [p, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        inferredPersona = p as Persona;
      }
    }
    
    // 如果没有任何特征被命中，就退回通用扫描
    if (maxScore === 0) inferredPersona = "unknown";
    
    setDetectedPersona(inferredPersona);

    const personaNames: Record<Persona, string> = {
      programmer: "👨‍💻 程序员",
      office: "💼 办公人员",
      ai_beginner: "🤖 AI 爱好者",
      unknown: "👤 通用用户"
    };

    // 阶段二：针对性深度扫描
    setScanStatus("scanning");
    setStatusMessage(`发现你是【${personaNames[inferredPersona]}】，正在针对你的习惯进行深度扫描...`);
    
    const pathsToScan = PERSONA_PATHS[inferredPersona].map(p => p.replace("{home}", homeDir));
    const scanResults: FolderSize[] = [];

    for (const path of pathsToScan) {
      try {
        const res: FolderSize = await invoke("get_folder_size", { path });
        if (res.size_bytes > 0) {
          scanResults.push(res);
        }
      } catch (e) {
        // Path might not exist, ignore
      }
    }

    setResults(scanResults.sort((a, b) => b.size_bytes - a.size_bytes));
    setScanStatus("done");
    setStatusMessage("扫描完成！");
  };

  const getAIAdvice = async () => {
    if (!llmConfig.apiKey) {
      alert("请先在右上角设置 LLM API Key");
      return;
    }
    setIsAiThinking(true);
    try {
      const openai = new OpenAI({
        baseURL: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
        dangerouslyAllowBrowser: true, // required for client-side API calls
      });

      const personaNames: Record<Persona, string> = {
        programmer: "程序员",
        office: "办公人员",
        ai_beginner: "AI小白/初学者",
        unknown: "普通电脑用户"
      };
      
      const personaName = personaNames[detectedPersona];

      const prompt = `你是一个专业的系统磁盘清理助手。系统通过自动探针发现该用户的身份习惯是【${personaName}】。
以下是系统针对该身份深度扫描出占用空间较大的关键目录及其大小：
${results.map(r => `- ${r.path}: ${formatBytes(r.size_bytes)}`).join("\n")}

请结合该用户的身份，分析上述目录的作用，给出详细、安全、专业的清理建议。
明确指出：哪些可以放心删除，哪些删除后会有什么副作用，哪些绝对不能删。`;

      const response = await openai.chat.completions.create({
        model: llmConfig.model,
        messages: [{ role: "system", content: prompt }],
      });

      setAiAdvice(response.choices[0].message.content || "未返回任何建议。");
    } catch (e: any) {
      setAiAdvice(`AI 分析出错: ${e.message}`);
    }
    setIsAiThinking(false);
  };

  const handleDelete = async (path: string) => {
    if (confirm(`确定要彻底删除 ${path} 吗？此操作不可逆！`)) {
      try {
        await invoke("delete_path", { path });
        alert("删除成功");
        handleScan(); // Rescan
      } catch (e: any) {
        alert(`删除失败: ${e}`);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <HardDrive className="w-8 h-8 text-blue-600" />
          AI Disk Cleaner
        </h1>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 bg-slate-200 rounded-full hover:bg-slate-300 transition"
        >
          <Settings className="w-5 h-5 text-slate-700" />
        </button>
      </header>

      {showSettings && (
        <div className="mb-8 p-4 bg-white rounded-xl shadow-sm border border-slate-100 grid gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Base URL</label>
            <input 
              type="text" 
              value={llmConfig.baseUrl}
              onChange={e => setLlmConfig({...llmConfig, baseUrl: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
            <input 
              type="password" 
              value={llmConfig.apiKey}
              onChange={e => setLlmConfig({...llmConfig, apiKey: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
              placeholder="sk-..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Model Name</label>
            <input 
              type="text" 
              value={llmConfig.model}
              onChange={e => setLlmConfig({...llmConfig, model: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
            />
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <div className="md:col-span-2 bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" /> 磁盘概览
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {diskInfo.map((disk, i) => (
              <div key={i} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="font-medium text-slate-800">{disk.name}</div>
                <div className="text-sm text-slate-500 mb-2">挂载点: {disk.mount_point}</div>
                <div className="w-full bg-slate-200 rounded-full h-2 mb-1">
                  <div 
                    className="bg-blue-600 h-2 rounded-full" 
                    style={{ width: \`\${((disk.total_space - disk.available_space) / disk.total_space) * 100}%\` }}
                  ></div>
                </div>
                <div className="flex justify-between text-xs text-slate-600">
                  <span>剩余 {formatBytes(disk.available_space)}</span>
                  <span>共 {formatBytes(disk.total_space)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center items-center gap-4">
          <div className="flex flex-col items-center gap-2 mb-2">
            <div className={`p-4 rounded-full ${scanStatus === 'idle' ? 'bg-slate-100' : 'bg-blue-50 text-blue-600'} transition-colors`}>
              <UserCircle2 className={`w-10 h-10 ${scanStatus === 'probing' || scanStatus === 'scanning' ? 'animate-pulse' : ''}`} />
            </div>
            <div className="font-semibold text-slate-800">
              {scanStatus === "idle" ? "准备扫描" :
               scanStatus === "probing" ? "探针扫描中..." :
               scanStatus === "scanning" ? "深度扫描中..." : 
               "扫描完成"}
            </div>
            <div className="text-sm text-slate-500 text-center min-h-[40px]">
              {statusMessage || "点击下方按钮，AI将自动分析你的电脑使用基因并寻找顽固缓存"}
            </div>
          </div>
          
          <button 
            onClick={handleScan}
            disabled={scanStatus === "probing" || scanStatus === "scanning"}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex justify-center items-center gap-2 transition disabled:opacity-50"
          >
            {(scanStatus === "probing" || scanStatus === "scanning") ? <span className="animate-spin">⏳</span> : <Search className="w-5 h-5" />}
            {(scanStatus === "probing" || scanStatus === "scanning") ? "AI 分析进行中..." : "一键智能清理扫描"}
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-semibold mb-4 flex justify-between items-center">
            扫描结果
            {results.length > 0 && (
              <span className="text-sm font-normal text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                共发现 {results.length} 个目标目录
              </span>
            )}
          </h2>
          
          {results.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>暂无扫描结果，点击上方按钮开始</p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((r, i) => (
                <div key={i} className="flex justify-between items-center p-3 hover:bg-slate-50 rounded-lg border border-transparent hover:border-slate-200 transition group">
                  <div className="truncate pr-4">
                    <div className="text-sm font-medium text-slate-800 truncate" title={r.path}>
                      {r.path.split(/[\/\\]/).pop()}
                    </div>
                    <div className="text-xs text-slate-400 truncate" title={r.path}>{r.path}</div>
                  </div>
                  <div className="flex items-center gap-4 whitespace-nowrap">
                    <span className="font-semibold text-orange-500">{formatBytes(r.size_bytes)}</span>
                    <button 
                      onClick={() => handleDelete(r.path)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition"
                      title="直接删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 flex flex-col">
          <h2 className="text-lg font-semibold mb-4 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Bot className="w-6 h-6 text-purple-600" />
              AI 清理建议
            </span>
            <button 
              onClick={getAIAdvice}
              disabled={isAiThinking || results.length === 0}
              className="text-sm px-4 py-1.5 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded-full font-medium transition disabled:opacity-50"
            >
              {isAiThinking ? "分析中..." : "生成分析报告"}
            </button>
          </h2>
          
          <div className="flex-1 bg-slate-50 rounded-lg p-4 text-sm text-slate-700 whitespace-pre-wrap overflow-y-auto max-h-[400px]">
            {aiAdvice || (
              <span className="text-slate-400 italic">
                扫描出结果后，点击右上角生成专属清理建议。大模型会根据你的使用习惯，告诉你哪些目录删了会导致环境损坏，哪些可以安全释放空间。
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
