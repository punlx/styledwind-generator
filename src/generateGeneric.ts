// generateGeneric.ts
export function generateGeneric(sourceCode: string): string {
  // -----------------------------------------------------------------------------
  // 1) หา styled`...` (บล็อกแรก) ด้วย Regex ที่จับ prefix + เนื้อหาใน backtick
  // -----------------------------------------------------------------------------
  const styledRegex = /\b(styled\s*(?:<[^>]*>)?)`([^`]*)`/gs;
  const match = styledRegex.exec(sourceCode);
  if (!match) return sourceCode;

  const fullMatch = match[0]; // ตัวเต็ม "styled ... ` ... `"
  const prefix = match[1]; // "styled" หรือ "styled<...>"
  const templateContent = match[2]; // โค้ดภายใน backtick

  // -----------------------------------------------------------------------------
  // 2) เตรียมโครงสร้าง classMap / constMap
  // -----------------------------------------------------------------------------
  const classMap: Record<string, Set<string>> = {};
  const constMap: Record<string, Set<string>> = {};

  // -----------------------------------------------------------------------------
  // 3) ฟังก์ชัน parse $xxx[...] (รวม pseudo)
  // -----------------------------------------------------------------------------
  function parseStylesIntoSet(content: string, targetSet: Set<string>) {
    const pseudoFnRegex =
      /\b(hover|focus|active|focus-visible|focus-within|target|before|after|screen|container)\s*\(([^)]*)\)/g;
    let fnMatch: RegExpExecArray | null;
    while ((fnMatch = pseudoFnRegex.exec(content)) !== null) {
      const pseudoFn = fnMatch[1];
      const inside = fnMatch[2];
      if (pseudoFn === 'screen' || pseudoFn === 'container') {
        continue;
      }
      const styleMatches = [...inside.matchAll(/(\$[\w-]+)\[/g)]
        .filter((m) => {
          const idx = m.index || 0;
          if (idx >= 2 && inside.slice(idx - 2, idx) === '--') {
            return false;
          }
          return true;
        })
        .map((m) => m[1]);
      for (const styleName of styleMatches) {
        targetSet.add(`${styleName}-${pseudoFn}`);
      }
    }

    const pseudoFnRegexForRemove =
      /\b(?:hover|focus|active|focus-visible|focus-within|target|before|after|screen|container)\s*\(([^)]*)\)/g;
    const contentWithoutFn = content.replace(pseudoFnRegexForRemove, '');

    const directMatches = [...contentWithoutFn.matchAll(/(\$[\w-]+)\[/g)]
      .filter((m) => {
        const idx = m.index || 0;
        if (idx >= 2 && contentWithoutFn.slice(idx - 2, idx) === '--') {
          return false;
        }
        return true;
      })
      .map((m) => m[1]);
    for (const styleName of directMatches) {
      targetSet.add(styleName);
    }
  }

  // -----------------------------------------------------------------------------
  // 4) Parse @const ... { ... } => ใส่ใน constMap
  // -----------------------------------------------------------------------------
  {
    const constRegex = /@const\s+([\w-]+)\s*\{([^}]*)\}/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = constRegex.exec(templateContent)) !== null) {
      const constName = cMatch[1];
      const constBody = cMatch[2];
      if (!constMap[constName]) {
        constMap[constName] = new Set();
      }
      parseStylesIntoSet(constBody, constMap[constName]);
    }
  }

  // -----------------------------------------------------------------------------
  // 5) Parse .className { ... } => เก็บลง classMap + merge @use
  // -----------------------------------------------------------------------------
  {
    const classRegex = /\.(\w+)(?:\([^)]*\))?\s*\{([^}]*)\}/g;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classRegex.exec(templateContent)) !== null) {
      const clsName = classMatch[1];
      const innerContent = classMatch[2];

      if (!classMap[clsName]) {
        classMap[clsName] = new Set();
      }

      // (A) ตรวจ @use ...
      {
        const useRegex = /@use\s+([^\{\}\n]+)/g;
        let useMatch: RegExpExecArray | null;
        while ((useMatch = useRegex.exec(innerContent)) !== null) {
          const usedConstsLine = useMatch[1];
          const usedConstNames = usedConstsLine.split(/\s+/).filter(Boolean);
          for (const cname of usedConstNames) {
            if (constMap[cname]) {
              for (const val of constMap[cname]) {
                classMap[clsName].add(val);
              }
            }
          }
        }
      }

      // (B) parse $xxx[...] + pseudo
      parseStylesIntoSet(innerContent, classMap[clsName]);
    }
  }

  // -----------------------------------------------------------------------------
  // 6) แยก directive @scope, @bind, @const ออกจากเนื้อหา
  // -----------------------------------------------------------------------------
  const lines = templateContent.split('\n');
  const scopeLines: string[] = [];
  const bindLines: string[] = [];
  const constBlocks: string[][] = [];
  const normalLines: string[] = [];

  function normalizeDirectiveLine(line: string) {
    const tokens = line.split(/\s+/).filter(Boolean);
    return tokens.join(' ');
  }

  {
    let i = 0;
    while (i < lines.length) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();
      if (!trimmed) {
        i++;
        continue;
      }

      if (trimmed.startsWith('@scope ')) {
        scopeLines.push(normalizeDirectiveLine(trimmed));
        i++;
        continue;
      }
      if (trimmed.startsWith('@bind ')) {
        bindLines.push(normalizeDirectiveLine(trimmed));
        i++;
        continue;
      }
      if (trimmed.startsWith('@const ')) {
        const blockLines: string[] = [];
        blockLines.push(trimmed);
        i++;
        while (i < lines.length) {
          const l = lines[i].trim();
          if (!l) {
            i++;
            continue;
          }
          blockLines.push(l);
          i++;
          if (l === '}') {
            break;
          }
        }
        constBlocks.push(blockLines);
        continue;
      }

      normalLines.push(trimmed);
      i++;
    }
  }

  // -----------------------------------------------------------------------------
  // 7) สร้าง Type ของ @bind => <bindKey>: []
  // -----------------------------------------------------------------------------
  const bindKeys: string[] = [];
  for (const bLine of bindLines) {
    const tokens = bLine.split(/\s+/);
    if (tokens.length > 1) {
      bindKeys.push(tokens[1]);
    }
  }
  const bindEntries = bindKeys.map((k) => `${k}: []`);

  // -----------------------------------------------------------------------------
  // 8) สร้าง entries ของ classMap
  // -----------------------------------------------------------------------------
  const classEntries = Object.keys(classMap).map((clsName) => {
    const arr = Array.from(classMap[clsName]);
    const arrLiteral = arr.map((a) => `"${a}"`).join(', ');
    return `${clsName}: [${arrLiteral}]`;
  });

  const allEntries = [...bindEntries, ...classEntries];
  const finalGeneric = `{ ${allEntries.join('; ')} }`;

  // -----------------------------------------------------------------------------
  // 9) ใส่ finalGeneric ลงใน prefix
  // -----------------------------------------------------------------------------
  let newPrefix: string;
  if (prefix.includes('<')) {
    newPrefix = prefix.replace(/<[^>]*>/, `<${finalGeneric}>`);
  } else {
    newPrefix = prefix + `<${finalGeneric}>`;
  }

  // -----------------------------------------------------------------------------
  // 10) ฟอร์แมต (@const block + .box block + directive) ตาม logic เดิม
  // -----------------------------------------------------------------------------
  // 10.1) format constBlocks
  const formattedConstBlocks: string[][] = [];
  for (const block of constBlocks) {
    const temp: string[] = [];
    let firstLine = true;
    for (const line of block) {
      if (firstLine) {
        temp.push(`\t${line}`);
        firstLine = false;
      } else if (line === '}') {
        temp.push(`\t${line}`);
      } else {
        temp.push(`\t\t${line}`);
      }
    }
    formattedConstBlocks.push(temp);
  }

  // 10.2) format .box {...} (normalLines) => เหมือนเดิม
  const formattedBlockLines: string[] = [];
  for (const line of normalLines) {
    let modifiedLine = line.replace(/\.(\w+)(?:\([^)]*\))?\s*\{/, (_, cName) => `.${cName} {`);
    if (/^\.\w+\s*\{/.test(modifiedLine)) {
      if (formattedBlockLines.length > 0) {
        formattedBlockLines.push('');
      }
      formattedBlockLines.push(`\t${modifiedLine}`);
    } else if (modifiedLine === '}') {
      formattedBlockLines.push(`\t${modifiedLine}`);
    } else {
      modifiedLine = modifiedLine.replace(/([\w-]+)\[\s*(.*?)\s*\]/g, '$1[$2]');
      formattedBlockLines.push(`\t\t${modifiedLine}`);
    }
  }

  // 10.3) รวม directive + constBlocks + normal block
  const finalLines: string[] = [];

  // @scope
  for (const s of scopeLines) {
    finalLines.push(`\t${s}`);
  }
  // @bind
  for (const b of bindLines) {
    finalLines.push(`\t${b}`);
  }
  if (scopeLines.length > 0 || bindLines.length > 0) {
    finalLines.push('');
  }

  formattedConstBlocks.forEach((block, idx) => {
    if (idx > 0) {
      finalLines.push('');
    }
    finalLines.push(...block);
  });
  if (formattedConstBlocks.length > 0) {
    finalLines.push('');
  }

  finalLines.push(...formattedBlockLines);

  const finalBlock = finalLines.join('\n');

  // -----------------------------------------------------------------------------
  // *** (เพิ่มเติม) 10.4) ฟอร์แมตรอบสอง: แค่เลื่อน 1 tab ให้บรรทัดใต้ @query ... { } ***
  // -----------------------------------------------------------------------------
  const finalBlock2 = secondPassQueryIndent(finalBlock);

  // -----------------------------------------------------------------------------
  // 11) Replace ลงใน sourceCode
  // -----------------------------------------------------------------------------
  const newStyledBlock = `${newPrefix}\`\n${finalBlock2}\n\``;
  return sourceCode.replace(fullMatch, newStyledBlock);

  // -----------------------------------------------------------------------------
  // ฟังก์ชันเล็ก ๆ สำหรับรอบสอง: เพิ่ม 1 tab ใต้ @query
  // -----------------------------------------------------------------------------
  function secondPassQueryIndent(code: string): string {
    const lines = code.split('\n');
    const newLines: string[] = [];
    let insideQuery = false;

    function addOneTab(line: string): string {
      return '\t' + line;
    }

    for (const line of lines) {
      const trimmed = line.trim();

      // 1) ถ้าเจอ @query ... { ให้ start insideQuery = true
      if (/^\s*@query\b.*\{/.test(line)) {
        newLines.push(line); // บรรทัดเปิด @query ไม่ขยับ
        insideQuery = true;
        continue;
      }

      // 2) ถ้าเจอ '}' แล้วกำลัง insideQuery => ถือเป็นปิด @query
      if (trimmed === '}') {
        if (insideQuery) {
          newLines.push(addOneTab(line));
          insideQuery = false;
        } else {
          newLines.push(line);
        }
        continue;
      }

      // 3) ถ้าอยู่ใน @query => บวก 1 tab
      if (insideQuery) {
        newLines.push(addOneTab(line));
      } else {
        newLines.push(line);
      }
    }
    return newLines.join('\n');
  }
}
