import OpenAI from "openai";
import { NextResponse } from "next/server";

const RESPONSE_FORMAT = {
  type: "json_schema",
  name: "repo_analysis",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "primary_languages",
      "tech_stack_tags",
      "entrypoints",
      "code_file_count",
      "analyzed_files",
      "notes",
    ],
    properties: {
      primary_languages: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "confidence"],
          properties: {
            name: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      tech_stack_tags: {
        type: "array",
        items: { type: "string" },
      },
      entrypoints: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "reason"],
          properties: {
            path: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      code_file_count: { type: "number" },
      analyzed_files: {
        type: "array",
        items: { type: "string" },
      },
      notes: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
  strict: true,
} as const;

type AnalyzeRequest = {
  repo: string;
  files: string[];
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL;
    if (!apiKey) {
      return NextResponse.json(
        { error: "缺少 OPENAI_API_KEY 环境变量。" },
        { status: 500 },
      );
    }

    const payload = (await request.json()) as AnalyzeRequest;
    if (!payload?.repo || !Array.isArray(payload.files)) {
      return NextResponse.json(
        { error: "请求参数不完整。" },
        { status: 400 },
      );
    }

    const fileList = payload.files.slice(0, 400);

    const client = new OpenAI({ apiKey, baseURL });
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "你是资深软件分析师。只输出符合 JSON Schema 的 JSON，不要输出任何额外文本或 Markdown。所有字段内容必须使用中文表述。",
        },
        {
          role: "user",
          content: [
            "请仅根据文件列表分析仓库。",
            "输出主要编程语言、技术栈标签、可能的入口文件（如 C 语言 main、Node 入口、Python main 等）。",
            "如果无法确定，请降低置信度并在 notes 说明原因。",
            "请根据文件名进行合理推断（例如 main.c、index.js、app.py）。",
            `仓库: ${payload.repo}`,
            "JSON模板:",
            JSON.stringify({
              primary_languages: [{ name: "TypeScript", confidence: 0.72 }],
              tech_stack_tags: ["Next.js", "React", "Tailwind CSS"],
              entrypoints: [{ path: "src/app/page.tsx", reason: "Next.js App Router 入口文件。" }],
              code_file_count: fileList.length,
              analyzed_files: fileList.slice(0, 20),
              notes: ["仅提供了文件列表，未分析文件内容。"],
            }),
            "文件列表:",
            fileList.join("\n"),
          ].join("\n"),
        },
      ],
      text: {
        format: {
          ...RESPONSE_FORMAT,
        },
      },
    });

    const outputText =
      // @ts-expect-error: SDK may not include output_text type in older versions
      response.output_text ??
      response.output?.[0]?.content?.[0]?.text ??
      "";

    if (!outputText) {
      return NextResponse.json(
        { error: "AI 未返回可解析的结果。" },
        { status: 502 },
      );
    }

    return NextResponse.json({ result: outputText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 分析失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
