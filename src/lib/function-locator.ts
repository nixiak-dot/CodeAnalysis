/**
 * 函数定位工具
 * 实现三阶段策略定位函数定义位置
 */

// 多语言函数定义正则表达式
const FUNCTION_PATTERNS: Record<string, RegExp[]> = {
  // JavaScript/TypeScript
  javascript: [
    // function name(...) { 或 export function name(...) {
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{?/g,
    // const name = (...) => { 或 const name = async (...) => {
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{?/g,
    // const name = function(...) {
    /(?:const|let|var)\s+(\w+)\s*=\s*function\s*\([^)]*\)\s*\{?/g,
    // class.method = function(...) { 或 class.method = (...) => {
    /\.(\w+)\s*=\s*(?:async\s*)?(?:function\s*)?\([^)]*\)\s*=>?\s*\{?/g,
    // obj.method(...) { (class method)
    /(\w+)\s*\([^)]*\)\s*\{?/g,
  ],
  typescript: [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[<\[]?[^)]*[>\]]?\s*\([^)]*\)\s*(:\s*\w+)?\s*\{?/g,
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*(:\s*\w+)?\s*\{?/g,
    /(?:const|let|var)\s+(\w+)\s*=\s*function\s*[<\[]?[^)]*[>\]]?\s*\([^)]*\)\s*(:\s*\w+)?\s*\{?/g,
    /(\w+)\s*[<\[]?[^)]*[>\]]?\s*\([^)]*\)\s*(:\s*\w+)?\s*\{?/g,
  ],
  // Python
  python: [
    // def name(...):
    /def\s+(\w+)\s*\([^)]*\)\s*(?:->\s*\w+)?\s*:/g,
    // async def name(...):
    /async\s+def\s+(\w+)\s*\([^)]*\)\s*(?:->\s*\w+)?\s*:/g,
    // class method
    /(\w+)\s*=\s*(?:staticmethod|classmethod)\s*\([^)]*\)/g,
  ],
  // Go
  go: [
    // func name(...) { 或 func (receiver) name(...) {
    /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\([^)]*\)\s*(?:\([^)]*\))?\s*\{?/g,
  ],
  // Rust
  rust: [
    // fn name(...) { 或 pub fn name(...) {
    /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*[<\[]?[^)]*[>\]]?\s*\([^)]*\)\s*(?:->\s*[^{]+)?\s*\{?/g,
  ],
  // Java
  java: [
    // public/private/protected ... name(...) {
    /(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{?/g,
  ],
  // C/C++
  c: [
    // type name(...) { 或 type Class::name(...) {
    /(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*(?:const\s*)?\{?/g,
    // name(...) { (simple function)
    /(\w+)\s*\([^)]*\)\s*\{?/g,
  ],
  cpp: [
    /(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*(?:const\s*)?\{?/g,
    /(\w+)\s*\([^)]*\)\s*\{?/g,
  ],
  // C#
  csharp: [
    /(?:public|private|protected|internal)?\s*(?:static\s+)?(?:virtual\s+)?(?:override\s+)?(?:async\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*\{?/g,
  ],
};

// 根据文件路径推断语言
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
  };
  return langMap[ext] || 'javascript';
}

// 在代码中搜索函数定义
export interface FunctionLocation {
  found: boolean;
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
  language: string;
}

// 在代码内容中查找函数定义
export function findFunctionInCode(
  functionName: string,
  code: string,
  filePath: string,
): { found: boolean; startLine: number; endLine: number; code: string } {
  const language = detectLanguage(filePath);
  const patterns = FUNCTION_PATTERNS[language] || FUNCTION_PATTERNS.javascript;
  
  const lines = code.split('\n');
  
  for (const pattern of patterns) {
    // 重置正则表达式的 lastIndex
    pattern.lastIndex = 0;
    
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const matchedName = match[1];
      
      if (matchedName === functionName) {
        // 找到函数定义，计算行号
        const beforeMatch = code.slice(0, match.index);
        const startLine = beforeMatch.split('\n').length;
        
        // 尝试找到函数结束位置（简单实现：找到匹配的大括号）
        let braceCount = 0;
        let foundOpenBrace = false;
        let endLine = startLine;
        
        for (let i = match.index; i < code.length; i++) {
          if (code[i] === '{') {
            braceCount++;
            foundOpenBrace = true;
          } else if (code[i] === '}') {
            braceCount--;
            if (foundOpenBrace && braceCount === 0) {
              const upToEnd = code.slice(0, i + 1);
              endLine = upToEnd.split('\n').length;
              break;
            }
          }
        }
        
        // 提取函数代码
        const functionCode = lines.slice(startLine - 1, endLine).join('\n');
        
        return {
          found: true,
          startLine,
          endLine,
          code: functionCode,
        };
      }
    }
  }
  
  return { found: false, startLine: 0, endLine: 0, code: '' };
}

// 三阶段函数定位策略
export interface LocateFunctionParams {
  functionName: string;
  likelyFile: string;
  allFiles: string[];
  fetchFileContent: (path: string) => Promise<string | null>;
  aiSuggestFile?: (functionName: string, allFiles: string[]) => Promise<string | null>;
}

export async function locateFunction(
  params: LocateFunctionParams,
): Promise<FunctionLocation> {
  const { functionName, likelyFile, allFiles, fetchFileContent, aiSuggestFile } = params;
  
  // 阶段1：在 likelyFile 中搜索
  if (likelyFile) {
    const code = await fetchFileContent(likelyFile);
    if (code) {
      const result = findFunctionInCode(functionName, code, likelyFile);
      if (result.found) {
        return {
          found: true,
          filePath: likelyFile,
          startLine: result.startLine,
          endLine: result.endLine,
          code: result.code,
          language: detectLanguage(likelyFile),
        };
      }
    }
  }
  
  // 阶段2：让 AI 推荐可能的文件
  if (aiSuggestFile) {
    const suggestedFile = await aiSuggestFile(functionName, allFiles);
    if (suggestedFile) {
      const code = await fetchFileContent(suggestedFile);
      if (code) {
        const result = findFunctionInCode(functionName, code, suggestedFile);
        if (result.found) {
          return {
            found: true,
            filePath: suggestedFile,
            startLine: result.startLine,
            endLine: result.endLine,
            code: result.code,
            language: detectLanguage(suggestedFile),
          };
        }
      }
    }
  }
  
  // 阶段3：在所有代码文件中搜索
  const codeExtensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs'];
  const codeFiles = allFiles.filter(f => 
    codeExtensions.some(ext => f.endsWith(ext))
  );
  
  for (const file of codeFiles) {
    // 跳过已经检查过的文件
    if (file === likelyFile) continue;
    
    const code = await fetchFileContent(file);
    if (code) {
      const result = findFunctionInCode(functionName, code, file);
      if (result.found) {
        return {
          found: true,
          filePath: file,
          startLine: result.startLine,
          endLine: result.endLine,
          code: result.code,
          language: detectLanguage(file),
        };
      }
    }
  }
  
  return {
    found: false,
    filePath: '',
    startLine: 0,
    endLine: 0,
    code: '',
    language: '',
  };
}

// 判断是否为系统函数/库函数
export function isSystemFunction(functionName: string): boolean {
  // 常见的系统函数和库函数前缀/名称
  const systemPatterns = [
    // JavaScript/TypeScript 内置
    /^console\./,
    /^Math\./,
    /^JSON\./,
    /^Object\./,
    /^Array\./,
    /^String\./,
    /^Number\./,
    /^Date\./,
    /^Promise\./,
    /^Symbol\./,
    /^Map\./,
    /^Set\./,
    /^WeakMap\./,
    /^WeakSet\./,
    /^Proxy\./,
    /^Reflect\./,
    /^Intl\./,
    /^setTimeout$/,
    /^setInterval$/,
    /^clearTimeout$/,
    /^clearInterval$/,
    /^requestAnimationFrame$/,
    /^cancelAnimationFrame$/,
    /^fetch$/,
    /^alert$/,
    /^confirm$/,
    /^prompt$/,
    /^eval$/,
    /^parseInt$/,
    /^parseFloat$/,
    /^isNaN$/,
    /^isFinite$/,
    /^encodeURI$/,
    /^decodeURI$/,
    /^encodeURIComponent$/,
    /^decodeURIComponent$/,
    /^escape$/,
    /^unescape$/,
    
    // Node.js 内置
    /^require$/,
    /^module\.exports/,
    /^process\./,
    /^Buffer\./,
    
    // Python 内置
    /^print$/,
    /^len$/,
    /^range$/,
    /^str$/,
    /^int$/,
    /^float$/,
    /^bool$/,
    /^list$/,
    /^dict$/,
    /^set$/,
    /^tuple$/,
    /^type$/,
    /^isinstance$/,
    /^issubclass$/,
    /^hasattr$/,
    /^getattr$/,
    /^setattr$/,
    /^delattr$/,
    /^callable$/,
    /^super$/,
    /^property$/,
    /^classmethod$/,
    /^staticmethod$/,
    /^input$/,
    /^open$/,
    /^abs$/,
    /^all$/,
    /^any$/,
    /^bin$/,
    /^chr$/,
    /^ord$/,
    /^dir$/,
    /^divmod$/,
    /^enumerate$/,
    /^eval$/,
    /^exec$/,
    /^filter$/,
    /^format$/,
    /^frozenset$/,
    /^globals$/,
    /^locals$/,
    /^hash$/,
    /^help$/,
    /^hex$/,
    /^id$/,
    /^iter$/,
    /^next$/,
    /^map$/,
    /^max$/,
    /^min$/,
    /^oct$/,
    /^pow$/,
    /^repr$/,
    /^reversed$/,
    /^round$/,
    /^slice$/,
    /^sorted$/,
    /^sum$/,
    /^vars$/,
    /^zip$/,
    
    // Go 内置
    /^make$/,
    /^new$/,
    /^len$/,
    /^cap$/,
    /^append$/,
    /^copy$/,
    /^delete$/,
    /^close$/,
    /^panic$/,
    /^recover$/,
    /^print$/,
    /^println$/,
    /^complex$/,
    /^real$/,
    /^imag$/,
    
    // Rust 内置
    /^println!$/,
    /^print!$/,
    /^format!$/,
    /^vec!$/,
    /^panic!$/,
    /^assert!$/,
    /^assert_eq!$/,
    /^assert_ne!$/,
    /^debug_assert!$/,
    /^debug_assert_eq!$/,
    /^debug_assert_ne!$/,
    /^unreachable!$/,
    /^unimplemented!$/,
    /^todo!$/,
    /^dbg!$/,
    /^eprintln!$/,
    /^eprint!$/,
    
    // C/C++ 标准库
    /^printf$/,
    /^scanf$/,
    /^malloc$/,
    /^calloc$/,
    /^realloc$/,
    /^free$/,
    /^exit$/,
    /^abort$/,
    /^atexit$/,
    /^system$/,
    /^getenv$/,
    /^atoi$/,
    /^atof$/,
    /^atol$/,
    /^strtol$/,
    /^strtod$/,
    /^rand$/,
    /^srand$/,
    /^time$/,
    /^clock$/,
    /^difftime$/,
    /^strftime$/,
    /^memcpy$/,
    /^memmove$/,
    /^memset$/,
    /^memcmp$/,
    /^strcpy$/,
    /^strncpy$/,
    /^strcat$/,
    /^strncat$/,
    /^strcmp$/,
    /^strncmp$/,
    /^strlen$/,
    /^strchr$/,
    /^strrchr$/,
    /^strstr$/,
    /^fopen$/,
    /^fclose$/,
    /^fread$/,
    /^fwrite$/,
    /^fprintf$/,
    /^fscanf$/,
    /^fgets$/,
    /^fputs$/,
    /^feof$/,
    /^ferror$/,
    /^fseek$/,
    /^ftell$/,
    /^rewind$/,
    /^fflush$/,
    /^fgetc$/,
    /^fputc$/,
    /^getchar$/,
    /^putchar$/,
    /^puts$/,
    /^gets$/,
    
    // Java 标准库
    /^System\./,
    /^Math\./,
    /^String\./,
    /^Integer\./,
    /^Long\./,
    /^Double\./,
    /^Float\./,
    /^Boolean\./,
    /^Character\./,
    /^Byte\./,
    /^Short\./,
    /^Object\./,
    /^Class\./,
    /^Thread\./,
    /^Runtime\./,
    /^Exception\./,
    /^Error\./,
    /^Throwable\./,
  ];
  
  return systemPatterns.some(pattern => pattern.test(functionName));
}

// 判断是否为核心/关键函数
export function isCoreFunction(
  functionName: string,
  summary: string,
  signals: string[],
): boolean {
  // 非核心函数的关键词
  const nonCoreKeywords = [
    '日志',
    'log',
    'debug',
    'trace',
    '打印',
    'print',
    '输出',
    'output',
    '格式化',
    'format',
    '转换',
    'convert',
    '解析',
    'parse',
    '序列化',
    'serialize',
    '辅助',
    'helper',
    '工具',
    'util',
    'getter',
    'setter',
    'get_',
    'set_',
    'is_',
    'has_',
    'can_',
    'should_',
    'validate',
    'check',
    'assert',
    'test',
    'mock',
    'stub',
    'fake',
  ];
  
  const lowerName = functionName.toLowerCase();
  const lowerSummary = summary.toLowerCase();
  const lowerSignals = signals.map(s => s.toLowerCase()).join(' ');
  
  // 检查函数名
  for (const keyword of nonCoreKeywords) {
    if (lowerName.includes(keyword.toLowerCase())) {
      return false;
    }
  }
  
  // 检查描述
  for (const keyword of nonCoreKeywords) {
    if (lowerSummary.includes(keyword.toLowerCase())) {
      return false;
    }
  }
  
  // 检查信号
  for (const keyword of nonCoreKeywords) {
    if (lowerSignals.includes(keyword.toLowerCase())) {
      return false;
    }
  }
  
  return true;
}
