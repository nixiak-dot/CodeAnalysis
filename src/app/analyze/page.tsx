"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  buildTree,
  filterCodeFiles,
  languageFromPath,
  parseGitHubUrl,
  TreeNode,
} from "@/lib/github";

type RepoContext = {
  owner: string;
  repo: string;
  branch: string;
  repoUrl: string;
  htmlUrl: string;
  description: string | null;
};

type AIAnalysis = {
  primary_languages: { name: string; confidence: number }[];
  tech_stack_tags: string[];
  entrypoints: { path: string; reason: string }[];
  code_file_count: number;
  analyzed_files: string[];
  notes: string[];
};

type EntrypointVerdict = {
  candidate_path: string;
  is_entrypoint: boolean;
  confidence: number;
  reason: string;
  signals: string[];
  next_action: "STOP_CONFIRMED" | "CONTINUE_NEXT" | "NEED_MORE_CONTEXT";
  suggested_more_files?: string[];
};

type FunctionPanorama = {
  entry: { name: string; file: string; summary: string; confidence: number };
  children: {
    name: string;
    likely_file: string;
    summary: string;
    drilldown: -1 | 0 | 1;
    confidence: number;
    signals: string[];
    children: unknown[];
  }[];
  notes: string[];
};

type FunctionNode = {
  name: string;
  file: string;
  summary: string;
  confidence: number;
  drilldown?: -1 | 0 | 1;
  children: FunctionNode[];
};

type LogEntry = {
  id: string;
  ts: string;
  level: "info" | "success" | "error";
  title: string;
  message: string;
  data?: unknown;
};

export default function AnalyzePage() {
  const searchParams = useSearchParams();

  const [repoUrl, setRepoUrl] = useState("");
  const [repoContext, setRepoContext] = useState<RepoContext | null>(null);

  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["root"]));
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [codeFiles, setCodeFiles] = useState<string[]>([]);

  const [selectedPath, setSelectedPath] = useState("");
  const [selectedContent, setSelectedContent] = useState("");
  const [selectedError, setSelectedError] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [panelWidths, setPanelWidths] = useState<[number, number, number]>([
    24, 36, 40,
  ]);
  const dragRef = useRef<{
    index: 0 | 1 | null;
    startX: number;
    startWidths: [number, number, number];
  } | null>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResult, setAiResult] = useState<AIAnalysis | null>(null);

  const [entryVerifyLoading, setEntryVerifyLoading] = useState(false);
  const [entryVerdict, setEntryVerdict] = useState<EntrypointVerdict | null>(
    null,
  );
  const [functionMapLoading, setFunctionMapLoading] = useState(false);
  const [functionMapError, setFunctionMapError] = useState("");
  const [functionMap, setFunctionMap] = useState<FunctionNode | null>(null);
  const functionMapRef = useRef<string>("");

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logDetail, setLogDetail] = useState<LogEntry | null>(null);
  const [detailView, setDetailView] = useState<"all" | "request" | "response">(
    "all",
  );

  // 全景图放大弹窗
  const [panoramaModalOpen, setPanoramaModalOpen] = useState(false);

  const language = useMemo(
    () => (selectedPath ? languageFromPath(selectedPath) : "text"),
    [selectedPath],
  );

  useEffect(() => {
    const repo = searchParams.get("repo");
    if (repo) {
      setRepoUrl(repo);
      void handleAnalyze(repo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!dragRef.current) return;
      const { index, startX, startWidths } = dragRef.current;
      if (index === null) return;

      const deltaPercent = ((event.clientX - startX) / window.innerWidth) * 100;
      const minWidth = 16;

      if (index === 0) {
        const left = Math.max(minWidth, startWidths[0] + deltaPercent);
        const middle = Math.max(minWidth, startWidths[1] - deltaPercent);
        const right = startWidths[2];
        if (left + middle + right <= 100) setPanelWidths([left, middle, right]);
      }
      if (index === 1) {
        const left = startWidths[0];
        const middle = Math.max(minWidth, startWidths[1] + deltaPercent);
        const right = Math.max(minWidth, startWidths[2] - deltaPercent);
        if (left + middle + right <= 100) setPanelWidths([left, middle, right]);
      }
    };

    const handleUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  const startDrag = (index: 0 | 1) => (event: React.MouseEvent) => {
    dragRef.current = {
      index,
      startX: event.clientX,
      startWidths: panelWidths,
    };
  };

  const appendLog = (entry: Omit<LogEntry, "id" | "ts">) => {
    const now = new Date();
    const log: LogEntry = {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: now.toLocaleString(),
      ...entry,
    };
    setLogs((prev) => [log, ...prev].slice(0, 80));
  };

  useEffect(() => {
    if (!repoContext || !aiResult || !entryVerdict) return;
    if (!entryVerdict.is_entrypoint) return;
    if (entryVerdict.next_action !== "STOP_CONFIRMED") return;

    const key = `${repoContext.owner}/${repoContext.repo}@${repoContext.branch}:${entryVerdict.candidate_path}`;
    if (functionMapRef.current === key) return;
    functionMapRef.current = key;

    void runFunctionPanorama(entryVerdict.candidate_path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoContext, aiResult, entryVerdict]);

  const handleAnalyze = async (override?: string) => {
    const input = (override ?? repoUrl).trim();
    const parsed = parseGitHubUrl(input);
    if (!parsed.ok) {
      setError(parsed.error);
      appendLog({
        level: "error",
        title: "GitHub 校验失败",
        message: parsed.error,
        data: { input },
      });
      return;
    }

    setError("");
    setLoading(true);
    setTree(null);
    setExpanded(new Set(["root"]));
    setSelectedPath("");
    setSelectedContent("");
    setSelectedError("");
    setAiError("");
    setAiResult(null);
    setEntryVerdict(null);
    setFunctionMapLoading(false);
    setFunctionMapError("");
    setFunctionMap(null);
    functionMapRef.current = "";

    try {
      const { owner, repo, branch } = parsed.data;
      appendLog({
        level: "success",
        title: "GitHub 校验通过",
        message: `${owner}/${repo}`,
        data: { owner, repo, branch },
      });

      const repoInfoRes = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "repo", owner, repo }),
      });
      if (!repoInfoRes.ok) {
        const errPayload = (await repoInfoRes.json()) as { error?: string };
        throw new Error(errPayload.error || "仓库不存在或无法访问。");
      }
      const repoInfo = (await repoInfoRes.json()) as {
        branch: string;
        description: string | null;
        html_url: string;
      };

      const resolvedBranch = branch ?? repoInfo.branch;
      const context: RepoContext = {
        owner,
        repo,
        branch: resolvedBranch,
        repoUrl: input,
        htmlUrl: repoInfo.html_url,
        description: repoInfo.description,
      };
      setRepoContext(context);

      const treeRes = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tree", owner, repo, branch: resolvedBranch }),
      });
      if (!treeRes.ok) {
        const errPayload = (await treeRes.json()) as { error?: string };
        throw new Error(errPayload.error || "无法读取仓库文件树，请稍后重试。");
      }

      const treePayload = (await treeRes.json()) as {
        tree: { path: string; type: "blob" | "tree" }[];
      };
      const filtered = treePayload.tree.filter(
        (item) => item.type === "blob" || item.type === "tree",
      );

      const fileCount = filtered.filter((item) => item.type === "blob").length;
      appendLog({
        level: "info",
        title: "文件列表统计",
        message: `共 ${fileCount} 个文件`,
        data: { fileCount },
      });

      const codeFiles = filterCodeFiles(
        filtered.filter((item) => item.type === "blob").map((item) => item.path),
      );
      setAllFiles(filtered.filter((item) => item.type === "blob").map((item) => item.path));
      setCodeFiles(codeFiles);
      appendLog({
        level: "info",
        title: "代码文件过滤",
        message: `保留 ${codeFiles.length} 个代码文件`,
        data: { codeFileCount: codeFiles.length, sampleFiles: codeFiles.slice(0, 50) },
      });

      const built = buildTree(filtered);
      const expandedNext = new Set<string>(["root"]);
      built.children?.forEach((node) => expandedNext.add(node.path));

      setExpanded(expandedNext);
      setTree(built);

      void runAiAnalysis(`${owner}/${repo}`, codeFiles, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : "解析失败，请检查链接。";
      setError(message);
      appendLog({ level: "error", title: "分析失败", message });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFile = async (path: string) => {
    if (!repoContext) return;
    setSelectedPath(path);
    setLoadingFile(true);
    setSelectedError("");
    setSelectedContent("");
    try {
      const result = await fetchRepoFileText(repoContext, path);
      if (!result.ok) throw new Error(result.error);
      setSelectedContent(result.text);
    } catch (err) {
      const message = err instanceof Error ? err.message : "文件读取失败。";
      setSelectedError(message);
    } finally {
      setLoadingFile(false);
    }
  };

  const runAiAnalysis = async (
    repoFullName: string,
    files: string[],
    ctx: RepoContext,
  ) => {
    if (!files.length) {
      setAiError("未识别到可分析的代码文件。");
      appendLog({
        level: "error",
        title: "AI 分析失败",
        message: "未识别到可分析的代码文件。",
      });
      return;
    }

    setAiLoading(true);
    setAiError("");
    try {
      const requestPayload = { repo: repoFullName, files };
      appendLog({
        level: "info",
        title: "AI 请求发送",
        message: `代码文件数 ${files.length}`,
        data: { request: requestPayload },
      });

      const res = await fetch("/api/ai-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      const payload = (await res.json()) as { result?: string; error?: string };
      if (!res.ok || !payload.result) {
        throw new Error(payload.error || "AI 分析失败。");
      }

      const parsed = JSON.parse(payload.result) as AIAnalysis;
      setAiResult(parsed);
      appendLog({
        level: "success",
        title: "AI 分析完成",
        message: [
          parsed.primary_languages.length
            ? `主要语言: ${parsed.primary_languages
              .map((l) => `${l.name}(${Math.round(l.confidence * 100)}%)`)
              .join(" / ")}`
            : "主要语言: 未识别",
          parsed.tech_stack_tags.length
            ? `技术栈: ${parsed.tech_stack_tags.join(" / ")}`
            : "技术栈: 未识别",
          parsed.entrypoints.length
            ? `入口候选: ${parsed.entrypoints.map((e) => e.path).join(" / ")}`
            : "入口候选: 未提供",
        ].join(" | "),
        data: { request: requestPayload, response: parsed },
      });

      if (parsed.entrypoints.length) {
        void verifyEntrypointsSequentially(parsed, ctx);
      } else {
        appendLog({
          level: "info",
          title: "入口研判跳过",
          message: "AI 未返回入口候选文件列表。",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI 分析失败。";
      setAiError(message);
      setAiResult(null);
      appendLog({ level: "error", title: "AI 分析失败", message });
    } finally {
      setAiLoading(false);
    }
  };

  const verifyEntrypointsSequentially = async (analysis: AIAnalysis, ctx: RepoContext) => {
    setEntryVerifyLoading(true);
    setEntryVerdict(null);

    appendLog({
      level: "info",
      title: "入口研判开始",
      message: `候选数量 ${analysis.entrypoints.length}`,
      data: { request: { entrypoints: analysis.entrypoints } },
    });

    for (const candidate of analysis.entrypoints) {
      try {
        const fileText = await fetchRepoFileText(ctx, candidate.path);
        if (!fileText.ok) {
          appendLog({
            level: "error",
            title: "入口研判读取失败",
            message: `${candidate.path}: ${fileText.error}`,
            data: { request: { path: candidate.path }, response: fileText },
          });
          continue;
        }

        const snippet = sliceByLines(fileText.text);
        const verifyRequest = {
          repo_url: ctx.repoUrl,
          repo_full_name: `${ctx.owner}/${ctx.repo}`,
          repo_description: ctx.description,
          primary_languages: analysis.primary_languages,
          candidate_path: candidate.path,
          snippet_mode: snippet.mode,
          total_lines: snippet.totalLines,
          sent_lines: snippet.sentLines,
          file_content: snippet.content,
        };

        appendLog({
          level: "info",
          title: "入口研判请求",
          message: `${candidate.path} (${snippet.mode}, 行数 ${snippet.totalLines})`,
          data: { request: verifyRequest },
        });

        const res = await fetch("/api/ai-entry-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(verifyRequest),
        });
        const payload = (await res.json()) as { result?: string; error?: string };
        if (!res.ok || !payload.result) {
          throw new Error(payload.error || "入口研判失败。");
        }

        const verdict = JSON.parse(payload.result) as EntrypointVerdict;
        appendLog({
          level: verdict.is_entrypoint ? "success" : "info",
          title: "入口研判结果",
          message: verdict.is_entrypoint
            ? `确认入口: ${verdict.candidate_path} (${Math.round(verdict.confidence * 100)}%)`
            : `不是入口: ${verdict.candidate_path} (${Math.round(verdict.confidence * 100)}%)`,
          data: { request: verifyRequest, response: verdict },
        });

        if (verdict.is_entrypoint && verdict.next_action === "STOP_CONFIRMED") {
          setEntryVerdict(verdict);
          appendLog({
            level: "success",
            title: "入口研判结束",
            message: `已确认入口文件，停止继续研判: ${verdict.candidate_path}`,
          });
          break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "入口研判失败。";
        appendLog({
          level: "error",
          title: "入口研判异常",
          message: `${candidate.path}: ${message}`,
        });
      }
    }

    setEntryVerifyLoading(false);
  };

  const runFunctionPanorama = async (entryFilePath: string) => {
    if (!repoContext || !aiResult) return;

    setFunctionMapLoading(true);
    setFunctionMapError("");
    setFunctionMap(null);

    try {
      const fileText = await fetchRepoFileText(repoContext, entryFilePath);
      if (!fileText.ok) throw new Error(fileText.error);

      const snippet = sliceByLines(fileText.text);
      const requestPayload = {
        repo_url: repoContext.htmlUrl || repoContext.repoUrl,
        repo_full_name: `${repoContext.owner}/${repoContext.repo}`,
        repo_description: repoContext.description,
        primary_languages: aiResult.primary_languages,
        tech_stack_tags: aiResult.tech_stack_tags,
        all_files: allFiles.length ? allFiles : codeFiles,
        entry_file_path: entryFilePath,
        snippet_mode: snippet.mode,
        total_lines: snippet.totalLines,
        sent_lines: snippet.sentLines,
        entry_file_content: snippet.content,
      };

      appendLog({
        level: "info",
        title: "函数全景请求",
        message: `${entryFilePath} (${snippet.mode}, 行数 ${snippet.totalLines})`,
        data: {
          request: {
            ...requestPayload,
            entry_file_content: truncateForLog(requestPayload.entry_file_content),
          },
        },
      });

      const res = await fetch("/api/ai-function-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      const payload = (await res.json()) as { result?: string; error?: string };
      if (!res.ok || !payload.result) {
        throw new Error(payload.error || "函数全景分析失败。");
      }

      const panorama = JSON.parse(payload.result) as FunctionPanorama;
      const root: FunctionNode = {
        name: panorama.entry.name,
        file: panorama.entry.file,
        summary: panorama.entry.summary,
        confidence: panorama.entry.confidence,
        children: panorama.children.map((child) => ({
          name: child.name,
          file: child.likely_file,
          summary: child.summary,
          confidence: child.confidence,
          drilldown: parseInt(String(child.drilldown), 10) as -1 | 0 | 1,
          children: [],
        })),
      };

      setFunctionMap(root);
      appendLog({
        level: "success",
        title: "函数全景结果",
        message: `入口函数 ${root.name}，关键子函数 ${root.children.length} 个`,
        data: {
          request: {
            ...requestPayload,
            entry_file_content: truncateForLog(requestPayload.entry_file_content),
          },
          response: panorama,
        },
      });

      // 自动开始递归下钻分析
      if (root.children.length > 0) {
        appendLog({
          level: "info",
          title: "开始自动递归下钻",
          message: `最大递归深度: ${maxRecursionDepth}`,
        });
        await runRecursiveAnalysis(root, 0);
        appendLog({
          level: "success",
          title: "递归下钻完成",
          message: "所有可下钻函数已分析完毕",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "函数全景分析失败。";
      setFunctionMapError(message);
      appendLog({ level: "error", title: "函数全景失败", message });
    } finally {
      setFunctionMapLoading(false);
    }
  };

  // 递归下钻分析
  const maxRecursionDepth = parseInt(
    process.env.NEXT_PUBLIC_MAX_RECURSION_DEPTH || "2",
    10,
  );

  // 获取文件内容的辅助函数
  const fetchFileContent = async (filePath: string): Promise<string | null> => {
    if (!repoContext) return null;
    try {
      const result = await fetchRepoFileText(repoContext, filePath);
      return result.ok ? result.text : null;
    } catch {
      return null;
    }
  };

  // 在代码中查找函数定义
  const findFunctionInCode = (
    functionName: string,
    code: string,
    filePath: string,
  ): { found: boolean; startLine: number; endLine: number; code: string } => {
    // 解析函数名：处理多种格式
    // 1. className.methodName (如 sqliteUtil.saveQueryResultToFile)
    // 2. ClassName::methodName (如 TsharkManager::startCapture)
    // 3. Namespace::ClassName::methodName (多级命名空间)
    let className = "";
    let methodName = functionName;

    // 优先处理 :: 分隔符（C++ 风格）
    if (functionName.includes("::")) {
      const parts = functionName.split("::");
      // 最后一部分是方法名，前面都是类名/命名空间
      methodName = parts[parts.length - 1];
      className = parts[parts.length - 2] || "";
    }
    // 然后处理 . 分隔符（对象调用风格）
    else if (functionName.includes(".")) {
      const parts = functionName.split(".");
      className = parts[0];
      methodName = parts[1];
    }

    // 根据文件扩展名选择正则表达式
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const patterns: { pattern: RegExp; extractName: (match: RegExpExecArray) => string; checkClass?: (match: RegExpExecArray) => boolean }[] = [];

    // JavaScript/TypeScript
    if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext)) {
      patterns.push(
        { pattern: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{?/g, extractName: (m) => m[1] },
        { pattern: /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{?/g, extractName: (m) => m[1] },
        { pattern: /(?:const|let|var)\s+(\w+)\s*=\s*function\s*\([^)]*\)\s*\{?/g, extractName: (m) => m[1] },
        // 类方法
        { pattern: /(\w+)\s*\([^)]*\)\s*\{?/g, extractName: (m) => m[1] },
      );
    }
    // Python
    else if (ext === "py") {
      patterns.push(
        { pattern: /def\s+(\w+)\s*\([^)]*\)\s*(?:->\s*\w+)?\s*:/g, extractName: (m) => m[1] },
        { pattern: /class\s+(\w+)\s*[:\(]/g, extractName: (m) => m[1] },
      );
    }
    // Go
    else if (ext === "go") {
      patterns.push(
        { pattern: /func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\([^)]*\)/g, extractName: (m) => m[3] },
      );
    }
    // Rust
    else if (ext === "rs") {
      patterns.push(
        { pattern: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*[<\[]?[^)]*[>\]]?\s*\([^)]*\)/g, extractName: (m) => m[1] },
        { pattern: /impl\s+(\w+)/g, extractName: (m) => m[1] },
      );
    }
    // Java
    else if (ext === "java") {
      patterns.push(
        { pattern: /(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*\{?/g, extractName: (m) => m[1] },
        { pattern: /class\s+(\w+)/g, extractName: (m) => m[1] },
      );
    }
    // C/C++
    else if (["c", "h", "cpp", "cc", "cxx", "hpp"].includes(ext)) {
      patterns.push(
        // 类方法: returnType ClassName::methodName(...)
        {
          pattern: /(?:\w+\s+)+(\w+)::(\w+)\s*\([^)]*\)\s*(?:const\s*)?\{?/g,
          extractName: (m) => m[2],
          checkClass: (m) => m[1] === className || !className
        },
        // 构造函数: ClassName::ClassName(...)
        {
          pattern: /(\w+)::(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{?/g,
          extractName: (m) => m[2],
          checkClass: (m) => m[1] === m[2] && (m[1] === className || !className)
        },
        // 普通函数: returnType functionName(...)
        { pattern: /(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*(?:const\s*)?\{?/g, extractName: (m) => m[1] },
      );
    }
    // 默认
    else {
      patterns.push(
        { pattern: /(\w+)\s*\([^)]*\)\s*\{?/g, extractName: (m) => m[1] },
      );
    }

    const lines = code.split("\n");

    for (const { pattern, extractName, checkClass } of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(code)) !== null) {
        const matchedName = extractName(match);

        // 匹配方法名
        if (matchedName === methodName) {
          // 如果有类名检查函数，使用它
          if (checkClass && !checkClass(match)) {
            continue;
          }

          const beforeMatch = code.slice(0, match.index);
          const startLine = beforeMatch.split("\n").length;

          // 找到函数结束位置
          let braceCount = 0;
          let foundOpenBrace = false;
          let endLine = startLine;

          for (let i = match.index; i < code.length; i++) {
            if (code[i] === "{") {
              braceCount++;
              foundOpenBrace = true;
            } else if (code[i] === "}") {
              braceCount--;
              if (foundOpenBrace && braceCount === 0) {
                endLine = code.slice(0, i + 1).split("\n").length;
                break;
              }
            }
          }

          const functionCode = lines.slice(startLine - 1, endLine).join("\n");
          return { found: true, startLine, endLine, code: functionCode };
        }
      }
    }

    return { found: false, startLine: 0, endLine: 0, code: "" };
  };

  // 定位函数位置（三阶段策略）
  const locateFunctionInProject = async (
    functionName: string,
    likelyFile: string,
  ): Promise<{ found: boolean; filePath: string; code: string }> => {
    // 阶段1：在 likelyFile 中搜索
    if (likelyFile) {
      const code = await fetchFileContent(likelyFile);
      if (code) {
        const result = findFunctionInCode(functionName, code, likelyFile);
        if (result.found) {
          return { found: true, filePath: likelyFile, code: result.code };
        }
      }
    }

    // 阶段2 & 3：在所有代码文件中搜索
    const codeExtensions = [
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".py",
      ".go",
      ".rs",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".hpp",
      ".cs",
    ];
    const codeFilesList = allFiles.filter((f) =>
      codeExtensions.some((ext) => f.endsWith(ext)),
    );

    for (const file of codeFilesList) {
      if (file === likelyFile) continue;
      const code = await fetchFileContent(file);
      if (code) {
        const result = findFunctionInCode(functionName, code, file);
        if (result.found) {
          return { found: true, filePath: file, code: result.code };
        }
      }
    }

    return { found: false, filePath: "", code: "" };
  };

  // 执行单次下钻分析
  const runDrilldownAnalysis = async (
    functionName: string,
    functionFile: string,
    currentDepth: number,
    parentFunction?: string,
  ): Promise<FunctionNode | null> => {
    if (!repoContext || !aiResult) return null;
    if (currentDepth >= maxRecursionDepth) return null;

    // 定位函数
    const location = await locateFunctionInProject(functionName, functionFile);
    if (!location.found) {
      appendLog({
        level: "info",
        title: "函数定位失败",
        message: `未找到函数 ${functionName} 的定义`,
      });
      return null;
    }

    appendLog({
      level: "info",
      title: "函数定位成功",
      message: `${functionName} 位于 ${location.filePath}`,
    });

    // 调用下钻分析 API
    try {
      const requestPayload = {
        repo_url: repoContext.htmlUrl || repoContext.repoUrl,
        repo_full_name: `${repoContext.owner}/${repoContext.repo}`,
        repo_description: repoContext.description,
        primary_languages: aiResult.primary_languages,
        tech_stack_tags: aiResult.tech_stack_tags,
        all_files: allFiles.length ? allFiles : codeFiles,
        function_name: functionName,
        function_file: location.filePath,
        function_code: location.code,
        current_depth: currentDepth,
        max_depth: maxRecursionDepth,
        parent_function: parentFunction,
      };

      // 记录请求日志 - 详细内容放在 data 字段
      appendLog({
        level: "info",
        title: "AI下钻请求",
        message: `函数: ${functionName}, 深度: ${currentDepth}/${maxRecursionDepth}`,
        data: {
          function_name: functionName,
          function_file: location.filePath,
          current_depth: currentDepth,
          max_depth: maxRecursionDepth,
          parent_function: parentFunction,
          function_code: location.code,
        },
      });

      const res = await fetch("/api/ai-function-drilldown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });

      const payload = (await res.json()) as { result?: string; error?: string };
      if (!res.ok || !payload.result) {
        appendLog({
          level: "error",
          title: "AI下钻响应错误",
          message: payload.error || "下钻分析失败",
          data: { error: payload.error },
        });
        throw new Error(payload.error || "下钻分析失败。");
      }

      // 记录响应日志 - 详细内容放在 data 字段
      appendLog({
        level: "success",
        title: "AI下钻响应",
        message: `函数 ${functionName} 分析完成`,
        data: {
          raw_response: payload.result,
          parsed_response: JSON.parse(payload.result),
        },
      });

      const drilldownResult = JSON.parse(payload.result) as {
        function_info: {
          name: string;
          file: string;
          summary: string;
          confidence: number;
        };
        children: Array<{
          name: string;
          likely_file: string;
          summary: string;
          drilldown: string;
          confidence: number;
          signals: string[];
        }>;
        stop_reason: string;
        notes: string[];
      };

      const node: FunctionNode = {
        name: drilldownResult.function_info.name,
        file: drilldownResult.function_info.file,
        summary: drilldownResult.function_info.summary,
        confidence: drilldownResult.function_info.confidence,
        children: drilldownResult.children.map((child) => ({
          name: child.name,
          file: child.likely_file,
          summary: child.summary,
          confidence: child.confidence,
          drilldown: parseInt(child.drilldown, 10) as -1 | 0 | 1,
          children: [],
        })),
      };

      appendLog({
        level: "success",
        title: "下钻分析完成",
        message: `${functionName}: 发现 ${node.children.length} 个子函数，停止原因: ${drilldownResult.stop_reason}`,
      });

      return node;
    } catch (err) {
      const message = err instanceof Error ? err.message : "下钻分析失败。";
      appendLog({ level: "error", title: "下钻分析失败", message });
      return null;
    }
  };

  // 递归执行下钻分析
  const runRecursiveAnalysis = async (
    node: FunctionNode,
    currentDepth: number = 0,
  ): Promise<void> => {
    // 确保 children 存在
    if (!node.children) {
      node.children = [];
    }

    appendLog({
      level: "info",
      title: "递归分析节点",
      message: `${node.name} (深度: ${currentDepth}, 子函数数: ${node.children.length}, 子函数列表: [${node.children.map(c => c.name).join(', ')}])`,
    });

    // 遍历所有子函数
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];

      // 只对 drilldown 为 0 或 1 的函数进行下钻
      if (child.drilldown !== 0 && child.drilldown !== 1) {
        appendLog({
          level: "info",
          title: "跳过下钻",
          message: `${child.name} (drilldown: ${child.drilldown})`,
        });
        continue;
      }

      // 检查是否超过最大递归深度
      if (currentDepth + 1 >= maxRecursionDepth) {
        appendLog({
          level: "info",
          title: "达到最大深度",
          message: `${child.name} (深度: ${currentDepth + 1} >= ${maxRecursionDepth}), 子函数数: ${child.children?.length || 0}`,
        });
        // 即使达到最大深度，也要确保子函数的 children 被保留
        // 不再继续下钻，但已有的子函数信息应该被渲染
        continue;
      }

      // 执行下钻分析
      const result = await runDrilldownAnalysis(
        child.name,
        child.file,
        currentDepth + 1,
        node.name,
      );

      if (result) {
        // 更新子函数的 children
        node.children[i] = result;

        appendLog({
          level: "success",
          title: "更新子函数",
          message: `${result.name} 现在有 ${result.children?.length || 0} 个子函数`,
        });

        // 递归分析新发现的子函数
        await runRecursiveAnalysis(result, currentDepth + 1);
      }
    }
  };

  // 开始递归下钻分析的入口函数
  const startRecursiveDrilldown = async () => {
    if (!functionMap) return;
    appendLog({
      level: "info",
      title: "开始递归下钻分析",
      message: `最大递归深度: ${maxRecursionDepth}`,
    });

    // 深拷贝 functionMap 以避免直接修改状态
    const functionMapCopy = JSON.parse(JSON.stringify(functionMap)) as FunctionNode;

    await runRecursiveAnalysis(functionMapCopy, 0);

    // 分析完成后，更新状态
    setFunctionMap(functionMapCopy);

    appendLog({
      level: "success",
      title: "递归下钻分析完成",
      message: "所有可下钻函数已分析完毕",
    });
  };

  return (
    <div className="grid-atmosphere min-h-screen px-4 py-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl flex-col gap-4">
        <header className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ink-soft)]">
              RepoScope Analyze
            </p>
            <h1 className="text-2xl font-semibold text-[color:var(--foreground)]">
              GitHub 项目代码分析
            </h1>
          </div>
          {repoContext ? (
            <div className="rounded-full border border-[color:var(--grid)] bg-[color:var(--surface)] px-4 py-2 text-sm text-[color:var(--ink-soft)]">
              {repoContext.owner}/{repoContext.repo} ·{" "}
              <span className="font-medium text-[color:var(--foreground)]">
                {repoContext.branch}
              </span>
            </div>
          ) : null}
        </header>

        <section className="flex flex-1 flex-col gap-3 lg:flex-row">
          <aside
            className="glass-panel flex flex-col gap-6 rounded-2xl p-5"
            style={{ width: `${panelWidths[0]}%` }}
          >
            <div className="rounded-xl border border-[color:var(--grid)] bg-[color:var(--surface)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ink-soft)]">
                    操作日志
                  </p>
                  <h2 className="text-sm font-semibold text-[color:var(--foreground)]">
                    分析过程记录
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setLogModalOpen(true)}
                  className="rounded-full border border-[color:var(--grid)] px-3 py-1 text-xs text-[color:var(--ink-soft)] hover:text-[color:var(--foreground)]"
                >
                  放大查看
                </button>
              </div>
              <div className="mt-3 max-h-48 space-y-2 overflow-auto text-xs">
                {logs.length ? (
                  logs.map((log) => (
                    <button
                      key={log.id}
                      type="button"
                      onClick={() => {
                        setLogModalOpen(true);
                        setLogDetail(log);
                        setDetailView("all");
                      }}
                      className="flex w-full flex-col gap-1 rounded-lg border border-transparent px-2 py-2 text-left hover:border-[color:var(--grid)] hover:bg-[color:var(--surface-muted)]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--foreground)]">
                          {log.title}
                        </span>
                        <span className="text-[color:var(--ink-soft)]">
                          {log.ts}
                        </span>
                      </div>
                      <span className="text-[color:var(--ink-soft)]">{log.message}</span>
                    </button>
                  ))
                ) : (
                  <p className="text-[color:var(--ink-soft)]">
                    暂无日志，开始分析后会记录关键操作。
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[color:var(--foreground)]">
                  项目地址
                </h2>
                <p className="text-xs text-[color:var(--ink-soft)]">
                  输入 GitHub 仓库链接并开始分析。
                </p>
              </div>
              <input
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                placeholder="https://github.com/vercel/next.js"
                className="h-11 w-full rounded-xl border border-[color:var(--grid)] bg-white px-3 text-sm focus:border-[color:var(--accent)] focus:outline-none"
              />
              <button
                onClick={() => void handleAnalyze()}
                className="h-11 w-full rounded-xl bg-[color:var(--foreground)] text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black"
              >
                {loading ? "分析中..." : "开始分析"}
              </button>
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
            </div>

            <div className="rounded-xl border border-[color:var(--grid)] bg-[color:var(--surface)] p-4 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                  AI 分析结果
                </h3>
                {aiLoading ? (
                  <span className="text-[color:var(--ink-soft)]">分析中...</span>
                ) : null}
              </div>

              {aiError ? <p className="mt-3 text-xs text-red-600">{aiError}</p> : null}

              {!aiError && aiResult ? (
                <div className="mt-3 space-y-3 text-xs text-[color:var(--ink-soft)]">
                  <div>
                    <p className="font-semibold text-[color:var(--foreground)]">
                      主要语言
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {aiResult.primary_languages.map((lang) => (
                        <span
                          key={lang.name}
                          className="rounded-full bg-[color:var(--surface-muted)] px-2 py-1 text-[color:var(--foreground)]"
                        >
                          {lang.name} · {(lang.confidence * 100).toFixed(0)}%
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="font-semibold text-[color:var(--foreground)]">
                      技术栈标签
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {aiResult.tech_stack_tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-[color:var(--grid)] px-2 py-1 text-[color:var(--foreground)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-[color:var(--foreground)]">
                        入口文件候选
                      </p>
                      {entryVerifyLoading ? (
                        <span className="text-[color:var(--ink-soft)]">研判中...</span>
                      ) : entryVerdict ? (
                        <span className="text-[color:var(--ink-soft)]">已确认</span>
                      ) : null}
                    </div>
                    {entryVerdict ? (
                      <div className="mt-2 rounded-xl border border-[color:var(--grid)] bg-[color:var(--surface-muted)] p-3">
                        <p className="text-[color:var(--foreground)]">
                          {entryVerdict.candidate_path}
                        </p>
                        <p className="mt-1 text-[color:var(--ink-soft)]">
                          {entryVerdict.reason}
                        </p>
                      </div>
                    ) : null}
                    <ul className="mt-2 space-y-2">
                      {aiResult.entrypoints.map((entry) => (
                        <li key={entry.path}>
                          <p className="text-[color:var(--foreground)]">{entry.path}</p>
                          <p className="text-[color:var(--ink-soft)]">{entry.reason}</p>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {aiResult.notes.length ? (
                    <div>
                      <p className="font-semibold text-[color:var(--foreground)]">
                        备注
                      </p>
                      <ul className="mt-2 space-y-1">
                        {aiResult.notes.map((note, index) => (
                          <li key={`${note}-${index}`}>• {note}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-xs text-[color:var(--ink-soft)]">
                  分析完成后将展示语言、技术栈与入口文件推测，并自动进行入口研判。
                </p>
              )}
            </div>

            <div className="rounded-xl border border-dashed border-[color:var(--grid)] p-4 text-xs text-[color:var(--ink-soft)]">
              预留区域：后续可加入复杂度指标、依赖关系图、热点文件等信息。
            </div>
          </aside>

          <div
            role="separator"
            onMouseDown={startDrag(0)}
            className="hidden w-2 cursor-col-resize rounded-full bg-[color:var(--grid)] hover:bg-[color:var(--accent)] lg:block"
          />

          <div
            className="glass-panel flex flex-col gap-4 rounded-2xl p-5"
            style={{ width: `${panelWidths[1]}%` }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[color:var(--foreground)]">
                项目文件结构
              </h2>
              <span className="text-xs text-[color:var(--ink-soft)]">
                {tree?.children?.length ? "已加载" : "等待分析"}
              </span>
            </div>
            <div className="h-[70vh] overflow-y-auto pr-2">
              {loading ? (
                <p className="text-sm text-[color:var(--ink-soft)]">正在生成文件树...</p>
              ) : tree ? (
                <TreeView
                  node={tree}
                  expanded={expanded}
                  onToggle={(path) => {
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    });
                  }}
                  onSelectFile={handleSelectFile}
                />
              ) : (
                <p className="text-sm text-[color:var(--ink-soft)]">
                  输入项目地址后即可查看文件结构。
                </p>
              )}
            </div>
          </div>

          <div
            role="separator"
            onMouseDown={startDrag(1)}
            className="hidden w-2 cursor-col-resize rounded-full bg-[color:var(--grid)] hover:bg-[color:var(--accent)] lg:block"
          />

          <div
            className="glass-panel flex flex-col rounded-2xl p-5"
            style={{ width: `${panelWidths[2]}%` }}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="flex items-center justify-between border-b border-[color:var(--grid)] pb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[color:var(--foreground)]">
                      代码面板
                    </h2>
                    <p className="text-xs text-[color:var(--ink-soft)]">
                      {selectedPath || "尚未选择文件"}
                    </p>
                  </div>
                  {loadingFile ? (
                    <span className="text-xs text-[color:var(--ink-soft)]">
                      载入中...
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 h-[70vh] overflow-auto rounded-xl border border-[color:var(--grid)] bg-[#0f1117] p-3 text-xs text-white">
                  {selectedContent ? (
                    <SyntaxHighlighter
                      language={language}
                      style={oneDark}
                      customStyle={{
                        margin: 0,
                        background: "transparent",
                        fontSize: "0.8rem",
                        fontFamily: "var(--font-mono)",
                      }}
                      showLineNumbers
                      wrapLongLines
                    >
                      {selectedContent}
                    </SyntaxHighlighter>
                  ) : selectedError ? (
                    <div className="flex h-full items-center justify-center text-sm text-gray-300">
                      {selectedError}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-gray-300">
                      选择文件后显示代码内容
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between border-b border-[color:var(--grid)] pb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[color:var(--foreground)]">
                      全景图面板
                    </h2>
                    <p className="text-xs text-[color:var(--ink-soft)]">
                      入口函数与关键子函数（支持递归下钻分析，最大深度 {maxRecursionDepth}）。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {functionMapLoading ? (
                      <span className="text-xs text-[color:var(--ink-soft)]">
                        生成中...
                      </span>
                    ) : null}
                    {functionMap ? (
                      <button
                        type="button"
                        onClick={() => setPanoramaModalOpen(true)}
                        className="rounded-lg border border-[color:var(--grid)] px-3 py-1.5 text-xs text-[color:var(--ink-soft)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
                      >
                        放大查看
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 h-[70vh] overflow-hidden rounded-xl border border-[color:var(--grid)] bg-[color:var(--surface)]">
                  {functionMapError ? (
                    <div className="flex h-full items-center justify-center px-4 text-sm text-red-600">
                      {functionMapError}
                    </div>
                  ) : functionMap ? (
                    <PanZoom>
                      <FunctionTree root={functionMap} />
                    </PanZoom>
                  ) : (
                    <div className="flex h-full items-center justify-center px-4 text-sm text-[color:var(--ink-soft)]">
                      确认入口文件后将自动生成函数全景图
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {logModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="glass-panel flex h-[80vh] w-full max-w-5xl flex-col gap-4 overflow-hidden rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ink-soft)]">
                  日志总览
                </p>
                <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
                  分析过程完整记录
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLogModalOpen(false);
                  setLogDetail(null);
                }}
                className="rounded-full border border-[color:var(--grid)] px-3 py-1 text-xs text-[color:var(--ink-soft)] hover:text-[color:var(--foreground)]"
              >
                关闭
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[1.1fr_1.4fr]">
              <div className="min-h-0 h-full overflow-auto rounded-xl border border-[color:var(--grid)] bg-[color:var(--surface)] p-3 text-xs">
                {logs.length ? (
                  logs.map((log) => (
                    <button
                      key={log.id}
                      type="button"
                      onClick={() => {
                        setLogDetail(log);
                        setDetailView("all");
                      }}
                      className={`mb-2 flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition ${logDetail?.id === log.id
                        ? "border-[color:var(--accent)] bg-[color:var(--surface-muted)]"
                        : "border-transparent hover:border-[color:var(--grid)] hover:bg-[color:var(--surface-muted)]"
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--foreground)]">
                          {log.title}
                        </span>
                        <span className="text-[color:var(--ink-soft)]">{log.ts}</span>
                      </div>
                      <span className="text-[color:var(--ink-soft)]">{log.message}</span>
                    </button>
                  ))
                ) : (
                  <p className="text-[color:var(--ink-soft)]">暂无日志。</p>
                )}
              </div>

              <div className="flex min-h-0 h-full flex-col overflow-hidden rounded-xl border border-[color:var(--grid)] bg-[#0f1117] p-4 text-xs text-white">
                {logDetail ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-gray-400">
                          当前日志
                        </p>
                        <h3 className="text-sm font-semibold text-white">
                          {logDetail.title}
                        </h3>
                      </div>
                      {hasReqRes(logDetail.data) ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDetailView("request")}
                            className={`rounded-full px-3 py-1 text-xs ${detailView === "request"
                              ? "bg-white text-black"
                              : "bg-white/10 text-white"
                              }`}
                          >
                            请求
                          </button>
                          <button
                            type="button"
                            onClick={() => setDetailView("response")}
                            className={`rounded-full px-3 py-1 text-xs ${detailView === "response"
                              ? "bg-white text-black"
                              : "bg-white/10 text-white"
                              }`}
                          >
                            响应
                          </button>
                          <button
                            type="button"
                            onClick={() => setDetailView("all")}
                            className={`rounded-full px-3 py-1 text-xs ${detailView === "all"
                              ? "bg-white text-black"
                              : "bg-white/10 text-white"
                              }`}
                          >
                            全部
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 min-h-0 flex-1 overflow-auto">
                      {logDetail.data ? (
                        <pre className="whitespace-pre-wrap text-xs">
                          {JSON.stringify(
                            (() => {
                              const data = logDetail.data as Record<string, unknown>;
                              // 原有的 request/response 格式
                              if (detailView === "request" && data.request) {
                                return data.request;
                              }
                              if (detailView === "response" && data.response) {
                                return data.response;
                              }
                              // AI 请求格式
                              if (detailView === "request" && data.function_code) {
                                return {
                                  function_name: data.function_name,
                                  function_file: data.function_file,
                                  current_depth: data.current_depth,
                                  max_depth: data.max_depth,
                                  parent_function: data.parent_function,
                                  function_code: data.function_code,
                                };
                              }
                              // AI 响应格式
                              if (detailView === "response" && data.raw_response) {
                                return data.parsed_response || data.raw_response;
                              }
                              // 全部显示
                              return data;
                            })(),
                            null,
                            2,
                          )}
                        </pre>
                      ) : (
                        <p className="text-gray-300">该日志暂无 JSON 详情。</p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-300">
                    选择左侧日志以查看详情
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 全景图放大弹窗 - 支持实时渲染查看 */}
      {panoramaModalOpen && functionMap ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex h-[90vh] w-full max-w-7xl flex-col gap-4 overflow-hidden rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ink-soft)]">
                  函数全景图
                </p>
                <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
                  函数调用层级可视化
                </h2>
                {functionMapLoading && (
                  <span className="text-xs text-emerald-600">正在递归分析中...</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPanoramaModalOpen(false)}
                className="rounded-full border border-[color:var(--grid)] px-4 py-1.5 text-sm text-[color:var(--ink-soft)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
              >
                关闭
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[color:var(--grid)] bg-[color:var(--surface)] p-6">
              {/* 调试信息 */}
              {(() => {
                console.log('=== functionMap 结构 ===');
                console.log('functionMap:', JSON.stringify(functionMap, null, 2));
                const printNode = (node: FunctionNode, depth: number) => {
                  const indent = '  '.repeat(depth);
                  console.log(`${indent}${node.name} (children: ${node.children?.length || 0})`);
                  (node.children || []).forEach(child => printNode(child, depth + 1));
                };
                if (functionMap) {
                  printNode(functionMap, 0);
                }
                return null;
              })()}
              <RecursiveFunctionTree root={functionMap} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function hasReqRes(data: unknown): data is { request: unknown; response: unknown } {
  if (!data || typeof data !== "object") return false;
  // 支持原有的 request/response 格式
  if ("request" in data && "response" in data) return true;
  // 支持 AI 请求格式 (function_code 表示请求)
  if ("function_code" in data) return true;
  // 支持 AI 响应格式 (raw_response 表示响应)
  if ("raw_response" in data) return true;
  return false;
}

function TreeView({
  node,
  expanded,
  onToggle,
  onSelectFile,
}: {
  node: TreeNode;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  if (!node.children) return null;
  return (
    <ul className="space-y-2">
      {node.children.map((child) => {
        const id = child.path || "root";
        const isExpanded = expanded.has(id);
        if (child.type === "dir") {
          return (
            <li key={child.path}>
              <button
                type="button"
                onClick={() => onToggle(id)}
                className="flex w-full items-center justify-between rounded-lg border border-transparent px-2 py-1 text-left text-sm text-[color:var(--foreground)] hover:border-[color:var(--grid)] hover:bg-[color:var(--surface-muted)]"
              >
                <span className="flex items-center gap-2">
                  <span className="text-xs text-[color:var(--ink-soft)]">
                    {isExpanded ? "▾" : "▸"}
                  </span>
                  {child.name}
                </span>
                <span className="text-xs text-[color:var(--ink-soft)]">目录</span>
              </button>
              {isExpanded ? (
                <div className="ml-3 mt-2 border-l border-[color:var(--grid)] pl-3">
                  <TreeView
                    node={child}
                    expanded={expanded}
                    onToggle={onToggle}
                    onSelectFile={onSelectFile}
                  />
                </div>
              ) : null}
            </li>
          );
        }
        return (
          <li key={child.path}>
            <button
              type="button"
              onClick={() => onSelectFile(child.path)}
              className="flex w-full items-center justify-between rounded-lg border border-transparent px-2 py-1 text-left text-sm text-[color:var(--ink-soft)] hover:border-[color:var(--grid)] hover:bg-[color:var(--surface-muted)]"
            >
              <span className="truncate">{child.name}</span>
              <span className="text-xs text-[color:var(--ink-soft)]">文件</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

async function fetchRepoFileText(
  ctx: RepoContext,
  path: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const res = await fetch("/api/github", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "content",
      owner: ctx.owner,
      repo: ctx.repo,
      branch: ctx.branch,
      path,
    }),
  });
  if (!res.ok) {
    const errPayload = (await res.json()) as { error?: string };
    return { ok: false, error: errPayload.error || "文件读取失败。" };
  }

  const payload = (await res.json()) as {
    type: "file" | "dir";
    encoding?: string;
    content?: string;
  };

  if (payload.type !== "file" || payload.encoding !== "base64" || !payload.content) {
    return { ok: false, error: "该路径不是可读取的文件。" };
  }

  const decoded = decodeBase64(payload.content);
  if (isProbablyBinary(decoded)) {
    return { ok: false, error: "检测到二进制或不可显示文件，暂不支持预览。" };
  }
  return { ok: true, text: decoded };
}

function sliceByLines(content: string): {
  mode: "full" | "head_tail";
  totalLines: number;
  sentLines: number;
  content: string;
} {
  const lines = content.split("\n");
  const totalLines = lines.length;
  if (totalLines <= 4000) {
    return { mode: "full", totalLines, sentLines: totalLines, content };
  }
  const head = lines.slice(0, 2000).join("\n");
  const tail = lines.slice(-2000).join("\n");
  const stitched = [
    head,
    "",
    "/* ... 省略中间内容（为降低成本与长度，仅发送前2000行与后2000行） ... */",
    "",
    tail,
  ].join("\n");
  return {
    mode: "head_tail",
    totalLines,
    sentLines: 4000,
    content: stitched,
  };
}

function decodeBase64(encoded: string) {
  const cleaned = encoded.replace(/\s/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function isProbablyBinary(text: string) {
  if (!text) return false;
  let suspicious = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 65533 || code === 0) suspicious += 1;
  }
  return suspicious / text.length > 0.02;
}

function truncateForLog(text: string, maxChars = 20000) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n/* ... 已截断，完整内容已发送给AI ... */`;
}

function FunctionTree({ root }: { root: FunctionNode }) {
  const children = root.children || [];

  return (
    <div className="min-h-full min-w-full p-6">
      <div className="flex justify-center">
        <FunctionNodeCard node={root} variant="entry" />
      </div>

      <div className="mx-auto mt-8 h-px w-24 bg-[color:var(--grid)]" />

      {children.length ? (
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          {children.map((child) => (
            <FunctionNodeCard key={`${child.file}:${child.name}`} node={child} />
          ))}
        </div>
      ) : (
        <div className="mt-10 text-center text-sm text-[color:var(--ink-soft)]">
          暂未识别到关键子函数
        </div>
      )}
    </div>
  );
}

// 递归函数树 - 用于放大弹窗，展示完整的调用层级
function RecursiveFunctionTree({ root }: { root: FunctionNode }) {
  return (
    <div className="inline-block">
      <RecursiveNode node={root} depth={0} />
    </div>
  );
}

// 递归节点组件 - 使用 CSS 边框实现连线
function RecursiveNode({ node, depth }: { node: FunctionNode; depth: number }) {
  const children = node.children || [];
  const hasChildren = children.length > 0;
  const cardWidth = 280;
  const horizontalLineLength = 50; // 水平虚线长度（单独调整此值只改变虚线长度）
  const horizontalLineOffset = 0; // 水平虚线左端到垂直虚线的距离（单独调整此值只改变距离）
  const verticalGap = 20; // 父卡片与子卡片之间的垂直间距
  const childGap = 20; // 子模块之间的间距
  const verticalLineBottomOffset = 70; // 垂直虚线从最下端减去的固定长度（可调整此值）

  return (
    <div className="relative flex flex-col">
      {/* 函数卡片 + 水平虚线（非入口节点才有水平虚线） */}
      <div className="relative z-10 flex items-center">
        {/* 水平虚线 - 只在非入口节点显示 */}
        {depth > 0 && (
          <div
            style={{
              width: `${horizontalLineLength}px`,
              height: '0',
              borderTop: '2px dashed #333',
              flexShrink: 0,
            }}
          />
        )}
        <FunctionNodeCardCompact node={node} isEntry={depth === 0} />
      </div>

      {/* 子函数区域 */}
      {hasChildren && (
        <div
          className="relative"
          style={{
            marginTop: `${verticalGap}px`,
            // 垂直虚线的位置：父卡片宽度的一半 + 水平虚线偏移量（非入口节点）
            marginLeft: `${(depth === 0 ? 0 : horizontalLineOffset) + cardWidth / 2}px`,
          }}
        >
          {/* 垂直虚线 - 使用 CSS 边框实现，从最下端减去固定长度 */}
          <div
            className="absolute"
            style={{
              left: '0',
              top: '0',
              bottom: `${verticalLineBottomOffset}px`,
              width: '0',
              borderLeft: '2px dashed #333',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          />

          {/* 子模块列表 */}
          <div className="flex flex-col" style={{ marginLeft: `${horizontalLineOffset}px` }}>
            {children.map((child, index) => (
              <div
                key={`${child.file}:${child.name}:${depth}:${index}`}
                style={{
                  marginTop: index === 0 ? 0 : `${childGap}px`,
                }}
              >
                <RecursiveNode node={child} depth={depth + 1} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 紧凑型函数卡片 - 用于递归树
function FunctionNodeCardCompact({ node, isEntry }: { node: FunctionNode; isEntry: boolean }) {
  // 确保所有字段都有默认值
  const fileName = node.file ? node.file.split("/").pop() : "未知";
  const functionName = node.name || "未知函数";
  const summary = node.summary || "暂无描述";
  const confidence = typeof node.confidence === 'number' ? node.confidence : 0;

  const drill = node.drilldown;
  const drillLabel =
    drill === 1 ? "建议下钻" : drill === 0 ? "不确定" : drill === -1 ? "不下钻" : "";
  const drillTone =
    drill === 1
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : drill === 0
        ? "bg-amber-100 text-amber-900 border-amber-200"
        : drill === -1
          ? "bg-zinc-100 text-zinc-900 border-zinc-200"
          : "bg-transparent text-transparent border-transparent";

  // 手绘感边框样式
  const sketchyBorder = {
    borderRadius: '8px 12px 10px 14px',
    border: '2px solid #333',
    boxShadow: '2px 2px 0px rgba(0,0,0,0.1)',
  };

  return (
    <div
      className="w-[280px] bg-white p-0"
      style={sketchyBorder}
    >
      {/* 文件名区域 */}
      <div className="border-b-2 border-dashed border-gray-300 px-3 py-2">
        <p className="truncate text-sm font-bold text-gray-800" title={node.file}>
          {fileName}
        </p>
      </div>

      {/* 函数名 + 描述区域 */}
      <div className="px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-xs font-bold text-gray-900" title={functionName}>
            {functionName}
          </h3>
          {!isEntry && drillLabel ? (
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${drillTone}`}>
              {drillLabel}
            </span>
          ) : null}
        </div>

        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-gray-600" title={summary}>
          {summary}
        </p>

        <div className="mt-2 flex items-center justify-between text-[9px] text-gray-500">
          <span>置信度</span>
          <span className="font-semibold text-gray-700">
            {(confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function FunctionNodeCard({
  node,
  variant,
}: {
  node: FunctionNode;
  variant?: "entry";
}) {
  const drill = node.drilldown;
  const drillLabel =
    drill === 1 ? "建议下钻" : drill === 0 ? "不确定" : drill === -1 ? "不下钻" : "";
  const drillTone =
    drill === 1
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : drill === 0
        ? "bg-amber-100 text-amber-900 border-amber-200"
        : drill === -1
          ? "bg-zinc-100 text-zinc-900 border-zinc-200"
          : "bg-transparent text-transparent border-transparent";

  return (
    <div className="w-[280px] rounded-2xl border border-[color:var(--grid)] bg-white p-4 shadow-[0_10px_24px_rgba(18,16,12,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
            {variant === "entry" ? "Entry Function" : "Child Function"}
          </p>
          <h3 className="mt-1 text-base font-semibold text-[color:var(--foreground)]">
            {node.name}
          </h3>
        </div>
        {variant !== "entry" && drillLabel ? (
          <span className={`shrink-0 rounded-full border px-2 py-1 text-xs ${drillTone}`}>
            {drillLabel}
          </span>
        ) : null}
      </div>

      <div className="mt-3 rounded-xl border border-[color:var(--grid)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs text-[color:var(--ink-soft)]">
        <span className="font-medium text-[color:var(--foreground)]">文件</span>{" "}
        {node.file || "未知"}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-[color:var(--ink-soft)]">
        {node.summary}
      </p>

      <div className="mt-4 flex items-center justify-between text-xs text-[color:var(--ink-soft)]">
        <span>置信度</span>
        <span className="font-semibold text-[color:var(--foreground)]">
          {(node.confidence * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

function PanZoom({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    pointerId: number;
  } | null>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY;
    const next = clamp(scale * (delta > 0 ? 0.92 : 1.08), 0.4, 2.6);
    setScale(next);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!containerRef.current) return;
    containerRef.current.setPointerCapture(event.pointerId);
    pointerRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      pointerId: event.pointerId,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const state = pointerRef.current;
    if (!state?.active) return;
    setOffset({
      x: state.originX + (event.clientX - state.startX),
      y: state.originY + (event.clientY - state.startY),
    });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const state = pointerRef.current;
    if (!state) return;
    if (state.pointerId !== event.pointerId) return;
    pointerRef.current = null;
  };

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full border border-[color:var(--grid)] bg-white/90 px-2 py-1 text-xs text-[color:var(--ink-soft)] backdrop-blur">
        <button
          type="button"
          onClick={() => setScale((s) => clamp(s * 1.1, 0.4, 2.6))}
          className="rounded-full border border-[color:var(--grid)] px-2 py-1 hover:text-[color:var(--foreground)]"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setScale((s) => clamp(s / 1.1, 0.4, 2.6))}
          className="rounded-full border border-[color:var(--grid)] px-2 py-1 hover:text-[color:var(--foreground)]"
        >
          -
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-[color:var(--grid)] px-2 py-1 hover:text-[color:var(--foreground)]"
        >
          重置
        </button>
      </div>

      <div
        ref={containerRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
