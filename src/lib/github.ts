export type RepoInfo = {
  owner: string;
  repo: string;
  branch?: string;
};

export type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
};

const httpsRegex =
  /^(https?:\/\/)?(www\.)?github\.com\/([^/]+)\/([^/#?]+)(?:\/tree\/([^/#?]+))?/i;
const sshRegex = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i;

export function parseGitHubUrl(raw: string):
  | { ok: true; data: RepoInfo }
  | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "请输入 GitHub 项目地址。" };
  }

  const httpsMatch = trimmed.match(httpsRegex);
  if (httpsMatch) {
    const owner = httpsMatch[3];
    const repoRaw = httpsMatch[4];
    const branch = httpsMatch[5];
    const repo = repoRaw.replace(/\.git$/i, "");
    if (!owner || !repo) {
      return { ok: false, error: "未识别出项目名称或仓库名。" };
    }
    return { ok: true, data: { owner, repo, branch } };
  }

  const sshMatch = trimmed.match(sshRegex);
  if (sshMatch) {
    const owner = sshMatch[1];
    const repo = sshMatch[2];
    return { ok: true, data: { owner, repo } };
  }

  return { ok: false, error: "地址格式不正确，请输入 GitHub 项目主页链接。" };
}

export function buildTree(paths: { path: string; type: "blob" | "tree" }[]): TreeNode {
  const root: TreeNode = { name: "root", path: "", type: "dir", children: [] };

  for (const item of paths) {
    const segments = item.path.split("/").filter(Boolean);
    let current = root;
    let currentPath = "";
    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLast = index === segments.length - 1;
      const nodeType: "dir" | "file" =
        isLast && item.type === "blob" ? "file" : "dir";

      if (!current.children) current.children = [];
      let child = current.children.find((c) => c.name === segment);
      if (!child) {
        child = {
          name: segment,
          path: currentPath,
          type: nodeType,
          children: nodeType === "dir" ? [] : undefined,
        };
        current.children.push(child);
      }
      current = child;
    });
  }

  sortTree(root);
  return root;
}

function sortTree(node: TreeNode) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
}

const languageMap: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  sh: "bash",
  bash: "bash",
  toml: "toml",
  xml: "xml",
  sql: "sql",
  php: "php",
  rb: "ruby",
};

export function languageFromPath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return languageMap[ext] ?? "text";
}

const codeExtensions = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "md",
  "mdx",
  "css",
  "scss",
  "html",
  "yml",
  "yaml",
  "py",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "sh",
  "bash",
  "toml",
  "xml",
  "sql",
  "php",
  "rb",
  "swift",
  "kt",
  "kts",
  "dart",
  "lua",
  "pl",
  "r",
  "cs",
]);

const codeFilenames = new Set([
  "makefile",
  "dockerfile",
  "gemfile",
  "rakefile",
  "podfile",
  "procfile",
]);

export function filterCodeFiles(paths: string[]) {
  return paths.filter((path) => {
    const parts = path.split("/");
    const name = parts[parts.length - 1] ?? "";
    const lowered = name.toLowerCase();
    if (codeFilenames.has(lowered)) return true;
    const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
    return ext ? codeExtensions.has(ext) : false;
  });
}
