"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseGitHubUrl } from "@/lib/github";

export default function Home() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError("");
    router.push(`/analyze?repo=${encodeURIComponent(repoUrl.trim())}`);
  };

  return (
    <div className="grid-atmosphere min-h-screen">
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-20">
        <div className="glass-panel relative overflow-hidden rounded-3xl p-10 md:p-16">
          <div className="absolute left-8 top-6 flex items-center gap-3 text-sm uppercase tracking-[0.3em] text-[color:var(--ink-soft)]">
            <span className="h-8 w-8 rounded-full border border-[color:var(--foreground)] bg-[color:var(--surface-muted)]" />
            RepoScope
          </div>

          <div className="mt-16 grid gap-12 md:grid-cols-[1.1fr_0.9fr] md:items-center">
            <div className="space-y-6">
              <h1 className="text-4xl font-semibold leading-tight text-[color:var(--foreground)] md:text-5xl">
                让 GitHub 项目结构一眼可见
              </h1>
              <p className="text-lg leading-relaxed text-[color:var(--ink-soft)]">
                输入仓库地址，立即生成文件树、查看代码高亮，并为后续分析做准备。
              </p>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <label className="text-sm font-medium text-[color:var(--ink-soft)]">
                  GitHub 项目地址
                </label>
                <div className="flex flex-col gap-3 md:flex-row">
                  <input
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    placeholder="https://github.com/vercel/next.js"
                    className="h-12 flex-1 rounded-2xl border border-[color:var(--grid)] bg-white px-4 text-sm text-[color:var(--foreground)] shadow-sm focus:border-[color:var(--accent)] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="h-12 rounded-2xl bg-[color:var(--foreground)] px-6 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black"
                  >
                    开始分析
                  </button>
                </div>
                {error ? (
                  <p className="text-sm text-red-600">{error}</p>
                ) : (
                  <p className="text-xs text-[color:var(--ink-soft)]">
                    支持公开仓库地址，示例链接可以直接粘贴。
                  </p>
                )}
              </form>
            </div>

            <div className="rounded-3xl border border-[color:var(--grid)] bg-[color:var(--surface)] p-6 shadow-[0_16px_40px_rgba(19,18,16,0.08)]">
              <div className="flex items-center justify-between text-sm text-[color:var(--ink-soft)]">
                <span>解析后的输出示意</span>
                <span className="rounded-full bg-[color:var(--surface-muted)] px-3 py-1 text-xs uppercase tracking-[0.2em]">
                  Beta
                </span>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-xl border border-[color:var(--grid)] bg-[color:var(--surface-muted)] p-4">
                  <p className="font-medium text-[color:var(--foreground)]">
                    文件树 + 语法高亮
                  </p>
                  <p className="text-xs text-[color:var(--ink-soft)]">
                    快速定位入口文件与关键模块。
                  </p>
                </div>
                <div className="rounded-xl border border-[color:var(--grid)] p-4">
                  <p className="font-medium text-[color:var(--foreground)]">
                    未来扩展空间
                  </p>
                  <p className="text-xs text-[color:var(--ink-soft)]">
                    将新增依赖分析、热点图与质量指标。
                  </p>
                </div>
                <div className="rounded-xl border border-dashed border-[color:var(--grid)] p-4 text-xs text-[color:var(--ink-soft)]">
                  三栏布局，让输入、结构与代码展示并行协作。
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
