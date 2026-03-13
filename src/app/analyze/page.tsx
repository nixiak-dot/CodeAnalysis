"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  buildTree,
  languageFromPath,
  parseGitHubUrl,
  TreeNode,
  filterCodeFiles,
} from "@/lib/github";

type RepoContext = {
  owner: string;
  repo: string;
  branch: string;
};

type AIAnalysis = {
  primary_languages: { name: string; confidence: number }[];
  tech_stack_tags: string[];
  entrypoints: { path: string; reason: string }[];
  code_file_count: number;
  analyzed_files: string[];
  notes: string[];
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
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedContent, setSelectedContent] = useState("");
  const [selectedError, setSelectedError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["root"]));
  const [panelWidths, setPanelWidths] = useState<[number, number, number]>([
    24, 36, 40,
  ]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResult, setAiResult] = useState<AIAnalysis | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logDetail, setLogDetail] = useState<LogEntry | null>(null);
  const [aiDetailView, setAiDetailView] = useState<"all" | "request" | "response">("all");
  const dragRef = useRef<{
    index: 0 | 1 | null;
    startX: number;
    startWidths: [number, number, number];
  } | null>(null);

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
      const delta = event.clientX - startX;
      const viewport = window.innerWidth;
      const deltaPercent = (delta / viewport) * 100;
      const minWidth = 16;

      if (index === 0) {
        const left = Math.max(minWidth, startWidths[0] + deltaPercent);
        const middle = Math.max(minWidth, startWidths[1] - deltaPercent);
        const right = startWidths[2];
        if (left + middle + right <= 100) {
          setPanelWidths([left, middle, right]);
        }
      } else if (index === 1) {
        const middle = Math.max(minWidth, startWidths[1] + deltaPercent);
        const right = Math.max(minWidth, startWidths[2] - deltaPercent);
        const left = startWidths[0];
        if (left + middle + right <= 100) {
          setPanelWidths([left, middle, right]);
        }
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
      setSelectedPath("");
      setSelectedContent("");
      setSelectedError("");
      setAiResult(null);
      setAiError("");

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
        const errorPayload = (await repoInfoRes.json()) as { error?: string };
        throw new Error(errorPayload.error || "仓库不存在或无法访问。");
      }
      const repoInfo = (await repoInfoRes.json()) as {
        default_branch?: string;
        branch?: string;
      };
      const resolvedBranch = branch ?? repoInfo.branch ?? repoInfo.default_branch;

      const treeRes = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tree", owner, repo, branch: resolvedBranch }),
      });
      if (!treeRes.ok) {
        const errorPayload = (await treeRes.json()) as { error?: string };
        throw new Error(errorPayload.error || "无法读取仓库文件树，请稍后重试。");
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
      appendLog({
        level: "info",
        title: "代码文件过滤",
        message: `保留 ${codeFiles.length} 个代码文件`,
        data: { codeFileCount: codeFiles.length },
      });
      const built = buildTree(filtered);

      const expandedNext = new Set<string>(["root"]);
      built.children?.forEach((node) => expandedNext.add(node.path));

      setExpanded(expandedNext);
      setRepoContext({ owner, repo, branch: resolvedBranch });
      setTree(built);
      void runAiAnalysis(`${owner}/${repo}`, codeFiles);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "解析失败，请检查链接。";
      setError(message);
      appendLog({
        level: "error",
        title: "分析失败",
        message,
      });
    } finally {
      setLoading(false);
    }
  };

  const runAiAnalysis = async (repo: string, files: string[]) => {
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
      const requestPayload = { repo, files };
      appendLog({
        level: "info",
        title: "AI 请求发送",
        message: `代码文件数 ${files.length}`,
        data: {
          repo,
          fileCount: files.length,
          sampleFiles: files.slice(0, 20),
        },
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
                .map((lang) => `${lang.name}(${Math.round(lang.confidence * 100)}%)`)
                .join(" / ")}`
            : "主要语言: 未识别",
          parsed.tech_stack_tags.length
            ? `技术栈: ${parsed.tech_stack_tags.join(" / ")}`
            : "技术栈: 未识别",
          parsed.entrypoints.length
            ? `入口: ${parsed.entrypoints.map((entry) => entry.path).join(" / ")}`
            : "入口: 未识别",
        ].join(" | "),
        data: {
          request: {
            repo,
            fileCount: files.length,
            sampleFiles: files.slice(0, 50),
          },
          response: parsed,
        },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "AI 分析失败。";
      setAiError(message);
      setAiResult(null);
      appendLog({
        level: "error",
        title: "AI 分析失败",
        message,
      });
    } finally {
      setAiLoading(false);
    }
  };

  const appendLog = (entry: Omit<LogEntry, "id" | "ts">) => {
    const now = new Date();
    const log: LogEntry = {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: now.toLocaleString(),
      ...entry,
    };
    setLogs((prev) => [log, ...prev].slice(0, 50));
  };

  const handleToggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleSelectFile = async (path: string) => {
    if (!repoContext) return;
    setSelectedPath(path);
    setLoadingFile(true);
    setSelectedError("");
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "content",
          owner: repoContext.owner,
          repo: repoContext.repo,
          branch: repoContext.branch,
          path,
        }),
      });
      if (!res.ok) {
        const errorPayload = (await res.json()) as { error?: string };
        throw new Error(errorPayload.error || "文件读取失败。");
      }
      const payload = (await res.json()) as {
        type: "file" | "dir";
        encoding?: string;
        content?: string;
        size?: number;
      };
      if (payload.type !== "file" || !payload.content || payload.encoding !== "base64") {
        throw new Error("该路径不是可读取的文件。");
      }
      const decoded = decodeBase64(payload.content);
      if (isProbablyBinary(decoded)) {
        setSelectedContent("");
        setSelectedError("检测到二进制或不可显示文件，暂不支持预览。");
      } else {
        setSelectedContent(decoded);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "文件读取失败。";
      setSelectedContent("");
      setSelectedError(message);
    } finally {
      setLoadingFile(false);
    }
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
                        setAiDetailView("all");
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
                      <span className="text-[color:var(--ink-soft)]">
                        {log.message}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="text-[color:var(--ink-soft)]">
                    暂无日志，开始分析后会记录关键操作。
                  </p>
                )}
              </div>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[color:var(--foreground)]">
                项目地址
              </h2>
              <p className="text-xs text-[color:var(--ink-soft)]">
                输入 GitHub 仓库链接并开始分析。
              </p>
            </div>
            <div className="space-y-3">
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
              {error ? (
                <p className="text-xs text-red-600">{error}</p>
              ) : (
                <p className="text-xs text-[color:var(--ink-soft)]">
                  当前版本支持公开仓库，未来可接入私有库认证。
                </p>
              )}
            </div>
            <div className="rounded-xl border border-dashed border-[color:var(--grid)] p-4 text-xs text-[color:var(--ink-soft)]">
              预留区域：后续可加入语言统计、复杂度指标、依赖关系图等信息。
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
              {aiError ? (
                <p className="mt-3 text-xs text-red-600">{aiError}</p>
              ) : aiResult ? (
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
                    <p className="font-semibold text-[color:var(--foreground)]">
                      可能的入口文件
                    </p>
                    <ul className="mt-2 space-y-2">
                      {aiResult.entrypoints.map((entry) => (
                        <li key={entry.path}>
                          <p className="text-[color:var(--foreground)]">
                            {entry.path}
                          </p>
                          <p className="text-[color:var(--ink-soft)]">
                            {entry.reason}
                          </p>
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
                  分析完成后将展示语言、技术栈与入口文件推测。
                </p>
              )}
            </div>
          </aside>
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
                            setAiDetailView("all");
                          }}
                          className={`mb-2 flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition ${
                            logDetail?.id === log.id
                              ? "border-[color:var(--accent)] bg-[color:var(--surface-muted)]"
                              : "border-transparent hover:border-[color:var(--grid)] hover:bg-[color:var(--surface-muted)]"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[color:var(--foreground)]">
                              {log.title}
                            </span>
                            <span className="text-[color:var(--ink-soft)]">
                              {log.ts}
                            </span>
                          </div>
                          <span className="text-[color:var(--ink-soft)]">
                            {log.message}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="text-[color:var(--ink-soft)]">
                        暂无日志，开始分析后会记录关键操作。
                      </p>
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
                          {logDetail.data &&
                          typeof logDetail.data === "object" &&
                          "request" in (logDetail.data as Record<string, unknown>) &&
                          "response" in (logDetail.data as Record<string, unknown>) ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setAiDetailView("request")}
                                className={`rounded-full px-3 py-1 text-xs ${
                                  aiDetailView === "request"
                                    ? "bg-white text-black"
                                    : "bg-white/10 text-white"
                                }`}
                              >
                                请求
                              </button>
                              <button
                                type="button"
                                onClick={() => setAiDetailView("response")}
                                className={`rounded-full px-3 py-1 text-xs ${
                                  aiDetailView === "response"
                                    ? "bg-white text-black"
                                    : "bg-white/10 text-white"
                                }`}
                              >
                                响应
                              </button>
                              <button
                                type="button"
                                onClick={() => setAiDetailView("all")}
                                className={`rounded-full px-3 py-1 text-xs ${
                                  aiDetailView === "all"
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
                            <pre className="whitespace-pre-wrap">
                              {JSON.stringify(
                                aiDetailView === "request"
                                  ? (logDetail.data as { request?: unknown }).request
                                  : aiDetailView === "response"
                                    ? (logDetail.data as { response?: unknown }).response
                                    : logDetail.data,
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
                <p className="text-sm text-[color:var(--ink-soft)]">
                  正在生成文件树...
                </p>
              ) : tree ? (
                <TreeView
                  node={tree}
                  expanded={expanded}
                  onToggle={handleToggle}
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
        </section>
      </div>
    </div>
  );
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
