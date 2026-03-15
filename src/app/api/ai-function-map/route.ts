import OpenAI from "openai";
import { NextResponse } from "next/server";

const RESPONSE_FORMAT = {
  type: "json_schema",
  name: "function_panorama",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["entry", "children", "notes"],
    properties: {
      entry: {
        type: "object",
        additionalProperties: false,
        required: ["name", "file", "summary", "confidence"],
        properties: {
          name: { type: "string" },
          file: { type: "string" },
          summary: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      children: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "name",
            "likely_file",
            "summary",
            "drilldown",
            "confidence",
            "signals",
            "children",
          ],
          properties: {
            name: { type: "string" },
            likely_file: { type: "string" },
            summary: { type: "string" },
            drilldown: { type: "string", enum: ["-1", "0", "1"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            signals: { type: "array", items: { type: "string" } },
            children: {
              type: "array",
              items: { type: "object" },
            },
          },
        },
      },
      notes: { type: "array", items: { type: "string" } },
    },
  },
  strict: true,
} as const;

type FunctionMapRequest = {
  repo_url: string;
  repo_full_name: string;
  repo_description: string | null;
  primary_languages: { name: string; confidence: number }[];
  tech_stack_tags: string[];
  all_files: string[];
  entry_file_path: string;
  snippet_mode: "full" | "head_tail";
  total_lines: number;
  sent_lines: number;
  entry_file_content: string;
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

    const payload = (await request.json()) as FunctionMapRequest;
    if (
      !payload?.repo_url ||
      !payload?.repo_full_name ||
      !payload?.entry_file_path ||
      !payload?.entry_file_content
    ) {
      return NextResponse.json({ error: "请求参数不完整。" }, { status: 400 });
    }

    const client = new OpenAI({ apiKey, baseURL });

    const jsonTemplate = {
      entry: {
        name: "main",
        file: payload.entry_file_path,
        summary: "入口函数，负责启动程序的核心流程。",
        confidence: 0.7,
      },
      children: [
        {
          name: "initConfig",
          likely_file: "src/config.ts",
          summary: "加载与解析配置。",
          drilldown: 1,
          confidence: 0.6,
          signals: ["名称暗示初始化", "与配置文件同目录"],
          children: [],
        },
      ],
      notes: ["仅分析入口文件内容与文件列表，未做全项目语义解析。"],
    };

    const response = await client.responses.create({
      model: "gemini-3-flash-preview",
      input: [
        {
          role: "system",
          content:
            "你是资深代码分析师。只输出符合 JSON Schema 的 JSON，不要输出任何额外文本或 Markdown。所有字段内容必须使用中文表述。",
        },
        {
          role: "user",
          content: [
            "任务：在已确认的入口文件基础上，找出入口函数以及它调用的关键子函数（<=20个）。",
            "关键子函数选择标准：结合仓库简介与核心功能逻辑，优先挑选对业务主流程影响最大的调用点（例如：初始化、路由/命令解析、核心处理、IO/网络、数据库、任务调度）。",
            "对每个子函数：",
            "- 估计它是否值得进一步下钻分析：drilldown = -1(不需要) / 0(不确定) / 1(需要)",
            "- 结合函数名、文件列表与上下文，猜测它可能定义在哪个文件（likely_file）",
            "- 输出该函数的中文功能简介（summary）与判断信号（signals）",
            "当前阶段：只分析入口函数的直接子函数；请为未来递归预留字段 children（当前返回空数组）。",
            "",
            `仓库链接: ${payload.repo_url}`,
            `仓库标识: ${payload.repo_full_name}`,
            `仓库简介: ${payload.repo_description ?? "无"}`,
            `主要语言: ${payload.primary_languages
              .map((l) => `${l.name}(${Math.round(l.confidence * 100)}%)`)
              .join(" / ") || "未知"}`,
            `技术栈标签: ${payload.tech_stack_tags.join(" / ") || "无"}`,
            "",
            `入口文件: ${payload.entry_file_path}`,
            `内容模式: ${payload.snippet_mode} (总行数 ${payload.total_lines}, 发送行数 ${payload.sent_lines})`,
            "",
            "JSON模板:",
            JSON.stringify(jsonTemplate),
            "",
            "文件列表(用于推断 likely_file):",
            payload.all_files.slice(0, 1500).join("\n"),
            "",
            "入口文件内容:",
            payload.entry_file_content,
          ].join("\n"),
        },
      ],
      text: { format: { ...RESPONSE_FORMAT } },
    });

    // @ts-expect-error provider output shape may vary
    const outputText = response.output_text ?? response.output?.[0]?.content?.[0]?.text ?? "";
    if (!outputText) {
      return NextResponse.json(
        { error: "AI 未返回可解析的结果。" },
        { status: 502 },
      );
    }

    return NextResponse.json({ result: outputText });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "函数全景分析失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

