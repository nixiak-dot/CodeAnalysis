import { NextResponse } from "next/server";

type RepoInfoResponse = {
  owner: string;
  repo: string;
  branch: string;
  description: string | null;
  html_url: string;
};

type RequestPayload =
  | { action: "repo"; owner: string; repo: string }
  | { action: "tree"; owner: string; repo: string; branch: string }
  | {
      action: "content";
      owner: string;
      repo: string;
      branch: string;
      path: string;
    };

const GITHUB_API = "https://api.github.com";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as RequestPayload;
    const token = process.env.GITHUB_TOKEN;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (payload.action === "repo") {
      const res = await fetch(`${GITHUB_API}/repos/${payload.owner}/${payload.repo}`, {
        headers,
        cache: "no-store",
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: "仓库不存在或无法访问。", status: res.status },
          { status: res.status },
        );
      }
      const data = (await res.json()) as {
        default_branch: string;
        description?: string | null;
        html_url: string;
      };
      const response: RepoInfoResponse = {
        owner: payload.owner,
        repo: payload.repo,
        branch: data.default_branch,
        description: data.description ?? null,
        html_url: data.html_url,
      };
      return NextResponse.json(response);
    }

    if (payload.action === "tree") {
      const res = await fetch(
        `${GITHUB_API}/repos/${payload.owner}/${payload.repo}/git/trees/${encodeURIComponent(
          payload.branch,
        )}?recursive=1`,
        { headers, cache: "no-store" },
      );
      if (!res.ok) {
        return NextResponse.json(
          { error: "无法读取仓库文件树。", status: res.status },
          { status: res.status },
        );
      }
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (payload.action === "content") {
      const res = await fetch(
        `${GITHUB_API}/repos/${payload.owner}/${payload.repo}/contents/${encodeURIComponent(
          payload.path,
        )}?ref=${encodeURIComponent(payload.branch)}`,
        { headers, cache: "no-store" },
      );
      if (!res.ok) {
        return NextResponse.json(
          { error: "文件读取失败。", status: res.status },
          { status: res.status },
        );
      }
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "未知操作。" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub 请求失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
