import OpenAI from "openai";
import { NextResponse } from "next/server";

const RESPONSE_FORMAT = {
  type: "json_schema",
  name: "entrypoint_verdict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "candidate_path",
      "is_entrypoint",
      "confidence",
      "reason",
      "signals",
      "next_action",
    ],
    properties: {
      candidate_path: { type: "string" },
      is_entrypoint: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
      signals: { type: "array", items: { type: "string" } },
      next_action: {
        type: "string",
        enum: ["STOP_CONFIRMED", "CONTINUE_NEXT", "NEED_MORE_CONTEXT"],
      },
      suggested_more_files: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
  strict: true,
} as const;

type VerifyRequest = {
  repo_url: string;
  repo_full_name: string;
  repo_description: string | null;
  primary_languages: { name: string; confidence: number }[];
  candidate_path: string;
  snippet_mode: "full" | "head_tail";
  total_lines: number;
  sent_lines: number;
  file_content: string;
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

    const payload = (await request.json()) as VerifyRequest;
    if (
      !payload?.repo_url ||
      !payload?.repo_full_name ||
      !payload?.candidate_path ||
      !payload?.file_content
    ) {
      return NextResponse.json({ error: "请求参数不完整。" }, { status: 400 });
    }

    const client = new OpenAI({ apiKey, baseURL });

    const jsonTemplate = {
      candidate_path: payload.candidate_path,
      is_entrypoint: false,
      confidence: 0.5,
      reason: "请用中文说明该文件是否可能是项目入口，以及判断依据。",
      signals: ["列出判断信号，如是否包含 main()/启动逻辑/CLI/服务器启动等"],
      next_action: "CONTINUE_NEXT",
      suggested_more_files: ["如果需要更多上下文，列出建议再查看的文件路径"],
    };

    const response = await client.responses.create({
      model: "gemini-3-flash-preview",
      input: [
        {
          role: "system",
          content:
            "你是资深软件架构与代码分析师。只输出符合 JSON Schema 的 JSON，不要输出任何额外文本或 Markdown。所有字段内容必须使用中文表述。",
        },
        {
          role: "user",
          content: [
            "任务：研判候选文件是否为项目真实入口文件，并给出理由。",
            "输入信息包含：仓库链接、仓库简介、主要语言、以及该候选文件的内容（可能是全文或头尾截取）。",
            "判断标准（举例）：是否包含 main()/启动函数、CLI 入口、Web 服务器启动、框架约定入口、包管理脚本入口等。",
            "若确定是入口：is_entrypoint=true 且 next_action=STOP_CONFIRMED。",
            "若不确定或不是入口：is_entrypoint=false 且 next_action=CONTINUE_NEXT；必要时用 NEED_MORE_CONTEXT 并给出 suggested_more_files。",
            "",
            `仓库链接: ${payload.repo_url}`,
            `仓库标识: ${payload.repo_full_name}`,
            `仓库简介: ${payload.repo_description ?? "无"}`,
            `主要语言: ${payload.primary_languages
              .map((l) => `${l.name}(${Math.round(l.confidence * 100)}%)`)
              .join(" / ") || "未知"}`,
            "",
            `候选文件: ${payload.candidate_path}`,
            `内容模式: ${payload.snippet_mode} (总行数 ${payload.total_lines}, 发送行数 ${payload.sent_lines})`,
            "",
            "JSON模板:",
            JSON.stringify(jsonTemplate),
            "",
            "候选文件内容:",
            payload.file_content,
          ].join("\n"),
        },
      ],
      text: { format: { ...RESPONSE_FORMAT } },
    });

    // UniAPI / third-party providers may vary; try common fields.
    // @ts-expect-error SDK shape can vary.
    const outputText = response.output_text ?? response.output?.[0]?.content?.[0]?.text ?? "";
    if (!outputText) {
      return NextResponse.json(
        { error: "AI 未返回可解析的结果。" },
        { status: 502 },
      );
    }

    return NextResponse.json({ result: outputText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 研判失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
