import OpenAI from "openai";
import { NextResponse } from "next/server";

const RESPONSE_FORMAT = {
  type: "json_schema",
  name: "function_drilldown",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["function_info", "children", "stop_reason", "notes"],
    properties: {
      function_info: {
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
          ],
          properties: {
            name: { type: "string" },
            likely_file: { type: "string" },
            summary: { type: "string" },
            drilldown: { type: "string", enum: ["-1", "0", "1"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            signals: { type: "array", items: { type: "string" } },
          },
        },
      },
      stop_reason: {
        type: "string",
        enum: ["continue", "max_depth", "not_found", "system_function", "non_core", "no_children"],
      },
      notes: { type: "array", items: { type: "string" } },
    },
  },
  strict: true,
} as const;

type DrilldownRequest = {
  repo_url: string;
  repo_full_name: string;
  repo_description: string | null;
  primary_languages: { name: string; confidence: number }[];
  tech_stack_tags: string[];
  all_files: string[];
  function_name: string;
  function_file: string;
  function_code: string;
  current_depth: number;
  max_depth: number;
  parent_function?: string;
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

    const payload = (await request.json()) as DrilldownRequest;
    if (
      !payload?.repo_url ||
      !payload?.function_name ||
      !payload?.function_code
    ) {
      return NextResponse.json({ error: "请求参数不完整。" }, { status: 400 });
    }

    // 检查是否达到最大深度
    if (payload.current_depth >= payload.max_depth) {
      return NextResponse.json({
        result: {
          function_info: {
            name: payload.function_name,
            file: payload.function_file,
            summary: "已达到最大递归深度，停止分析。",
            confidence: 0.5,
          },
          children: [],
          stop_reason: "max_depth",
          notes: [`当前深度 ${payload.current_depth} 已达到最大深度 ${payload.max_depth}`],
        },
      });
    }

    const client = new OpenAI({ apiKey, baseURL });

    const jsonTemplate = {
      function_info: {
        name: payload.function_name,
        file: payload.function_file,
        summary: "该函数的功能描述。",
        confidence: 0.7,
      },
      children: [
        {
          name: "helperFunction",
          likely_file: "src/utils.ts",
          summary: "辅助函数，处理数据转换。",
          drilldown: "0",
          confidence: 0.6,
          signals: ["名称暗示辅助功能", "可能为工具函数"],
        },
      ],
      stop_reason: "continue",
      notes: ["分析完成，发现 1 个子函数。"],
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
            "任务：分析给定函数的代码，找出它调用的关键子函数（<=20个）。",
            "",
            "分析要求：",
            "1. 仔细阅读函数代码，识别所有被调用的函数",
            "2. 过滤掉系统函数、库函数、内置函数",
            "3. 优先选择对业务逻辑有重要影响的函数",
            "4. 对每个子函数：",
            "   - 估计是否值得进一步下钻分析：drilldown = -1(不需要) / 0(不确定) / 1(需要)",
            "   - 结合函数名、文件列表与上下文，猜测它可能定义在哪个文件（likely_file）",
            "   - 输出该函数的中文功能简介（summary）与判断信号（signals）",
            "",
            "停止条件判断：",
            "- 如果找不到函数定义，stop_reason = 'not_found'",
            "- 如果是系统函数/库函数，stop_reason = 'system_function'",
            "- 如果是非核心/非关键函数，stop_reason = 'non_core'",
            "- 如果没有子函数，stop_reason = 'no_children'",
            "- 否则 stop_reason = 'continue'",
            "",
            `当前递归深度: ${payload.current_depth} / ${payload.max_depth}`,
            `父函数: ${payload.parent_function || '无（顶层）'}`,
            "",
            `仓库链接: ${payload.repo_url}`,
            `仓库标识: ${payload.repo_full_name}`,
            `仓库简介: ${payload.repo_description ?? "无"}`,
            `主要语言: ${payload.primary_languages
              .map((l) => `${l.name}(${Math.round(l.confidence * 100)}%)`)
              .join(" / ") || "未知"}`,
            `技术栈标签: ${payload.tech_stack_tags.join(" / ") || "无"}`,
            "",
            `当前函数: ${payload.function_name}`,
            `所在文件: ${payload.function_file}`,
            "",
            "JSON模板:",
            JSON.stringify(jsonTemplate),
            "",
            "文件列表(用于推断 likely_file):",
            payload.all_files.slice(0, 1500).join("\n"),
            "",
            "函数代码:",
            payload.function_code,
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
      error instanceof Error ? error.message : "函数下钻分析失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
