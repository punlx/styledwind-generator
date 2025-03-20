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
  // 2) จับ class .xxx {...} เพื่อสร้าง classMap (เก็บ $xxx[...] เพื่อใส่ใน Generic)
  // -----------------------------------------------------------------------------
  const classRegex = /\.(\w+)(?:\([^)]*\))?\s*\{([^}]*)\}/g;
  const classMap: Record<string, Set<string>> = {};

  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRegex.exec(templateContent)) !== null) {
    const clsName = classMatch[1];
    const innerContent = classMatch[2];

    if (!classMap[clsName]) {
      classMap[clsName] = new Set();
    }

    // จับ pseudo function ยกเว้น screen, container
    const pseudoFnRegex =
      /\b(hover|focus|active|focus-visible|focus-within|target|before|after|screen|container)\s*\(([^)]*)\)/g;
    let fnMatch: RegExpExecArray | null;

    while ((fnMatch = pseudoFnRegex.exec(innerContent)) !== null) {
      const pseudoFn = fnMatch[1];
      const inside = fnMatch[2];

      // ถ้าเป็น screen, container ให้ข้าม
      if (pseudoFn === 'screen' || pseudoFn === 'container') {
        continue;
      }

      // หา $xxx[...] ภายใน pseudo
      const styleMatches = [...inside.matchAll(/(\$[\w-]+)\[/g)].map((m) => m[1]);
      for (const styleName of styleMatches) {
        classMap[clsName].add(`${styleName}-${pseudoFn}`);
      }
    }

    // จับ $xxx[...] นอก pseudo function
    const pseudoFnRegexForRemove =
      /\b(?:hover|focus|active|focus-visible|focus-within|target|before|after|screen|container)\s*\(([^)]*)\)/g;
    const contentWithoutFn = innerContent.replace(pseudoFnRegexForRemove, '');

    const directMatches = [...contentWithoutFn.matchAll(/(\$[\w-]+)\[/g)].map((m) => m[1]);
    for (const styleName of directMatches) {
      classMap[clsName].add(styleName);
    }
  }

  // -----------------------------------------------------------------------------
  // 3) แยก directive (@scope, @bind, @const) ออกจากเนื้อหา
  //    - @bind -> สร้าง type
  //    - @scope, @bind, @const -> จัดวางด้านบน (ตามลำดับ)
  //    - ส่วนที่เหลือคือ .box {...} => indent ตาม logic เดิม
  // -----------------------------------------------------------------------------

  // แปลงทั้งหมดเป็นบรรทัด
  const lines = templateContent.split('\n');

  // ที่เก็บสำหรับ:
  const scopeLines: string[] = []; // บรรทัด @scope ...
  const bindLines: string[] = []; // บรรทัด @bind ...
  const constBlocks: string[][] = []; // เก็บบล็อก @const ... { ... }
  const normalLines: string[] = []; // บรรทัดปกติ (และ .box {...})

  // ฟังก์ชันช่วย: จัด spacing ให้เหลือ 1 space ระหว่าง token
  function normalizeDirectiveLine(line: string) {
    const tokens = line.split(/\s+/).filter(Boolean);
    return tokens.join(' ');
  }

  // parse lines และดึง @const เป็น "block"
  {
    let i = 0;
    while (i < lines.length) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      // ถ้าเจอ @scope
      if (trimmed.startsWith('@scope ')) {
        scopeLines.push(normalizeDirectiveLine(trimmed));
        i++;
        continue;
      }

      // ถ้าเจอ @bind
      if (trimmed.startsWith('@bind ')) {
        bindLines.push(normalizeDirectiveLine(trimmed));
        i++;
        continue;
      }

      // ถ้าเจอ @const <name> { => เก็บเป็น block
      if (trimmed.startsWith('@const ')) {
        const blockLines: string[] = [];
        // บรรทัดแรก
        blockLines.push(trimmed);

        // จากนั้นอ่านต่อจนเจอ '}'
        i++;
        let foundClose = false;
        while (i < lines.length) {
          const l = lines[i].trim();
          if (!l) {
            i++;
            continue;
          }
          blockLines.push(l);
          i++;

          if (l === '}') {
            foundClose = true;
            break;
          }
        }
        // push blockLines ไป constBlocks
        constBlocks.push(blockLines);
        continue;
      }

      // อื่น ๆ => normal
      normalLines.push(trimmed);
      i++;
    }
  }

  // -----------------------------------------------------------------------------
  // 4) จัดการสร้าง type จาก @bind => <bindKey>: []
  // -----------------------------------------------------------------------------
  const bindKeys: string[] = [];
  for (const bindLine of bindLines) {
    const tokens = bindLine.split(/\s+/);
    // ตัวอย่าง: ["@bind","box1and2",".box1",".box2",...]
    if (tokens.length > 1) {
      const bindKey = tokens[1];
      bindKeys.push(bindKey);
    }
  }

  // สร้าง entries ของ @bind (ว่าง [])
  const bindEntries = bindKeys.map((key) => {
    return `${key}: []`;
  });

  // -----------------------------------------------------------------------------
  // 5) สร้าง entries ของ classMap (เหมือน logic เดิม)
  // -----------------------------------------------------------------------------
  const classEntries = Object.keys(classMap).map((clsName) => {
    const arr = Array.from(classMap[clsName]);
    const arrLiteral = arr.map((a) => `"${a}"`).join(', ');
    return `${clsName}: [${arrLiteral}]`;
  });

  // รวม bindEntries มาก่อน + classEntries ทีหลัง
  const allEntries = [...bindEntries, ...classEntries];
  const finalGeneric = `{ ${allEntries.join('; ')} }`;

  // -----------------------------------------------------------------------------
  // 6) ใส่ finalGeneric ลงไปใน prefix (styled<...>)
  // -----------------------------------------------------------------------------
  let newPrefix: string;
  if (prefix.includes('<')) {
    newPrefix = prefix.replace(/<[^>]*>/, `<${finalGeneric}>`);
  } else {
    newPrefix = prefix + `<${finalGeneric}>`;
  }

  // -----------------------------------------------------------------------------
  // 7) จัดฟอร์แมต constBlocks (เหมือน .box) => เก็บเป็น formattedConstBlocks
  // -----------------------------------------------------------------------------
  const formattedConstBlocks: string[][] = [];
  for (const block of constBlocks) {
    // block = array ของบรรทัด เช่น ["@const bgRed {", "bg[red]", "}"]
    const temp: string[] = [];
    let isFirstLine = true;

    for (const line of block) {
      if (isFirstLine) {
        // บรรทัดเปิด => indent 1 tab
        // ex: "@const bgRed {"
        temp.push(`\t${line}`);
        isFirstLine = false;
      } else if (line === '}') {
        // บรรทัดปิด => indent 1 tab
        temp.push(`\t${line}`);
      } else {
        // ภายใน => indent 2 tab
        // ex: "bg[red]" => "\t\tbg[red]"
        temp.push(`\t\t${line}`);
      }
    }

    formattedConstBlocks.push(temp);
  }

  // -----------------------------------------------------------------------------
  // 8) จัดฟอร์แมตส่วน .box {...} (normalLines) ตาม logic เดิม
  // -----------------------------------------------------------------------------
  const formattedBlockLines: string[] = [];
  for (const line of normalLines) {
    let modifiedLine = line.replace(/\.(\w+)(?:\([^)]*\))?\s*\{/, (matchStr, className) => {
      return `.${className} {`;
    });

    if (/^\.\w+\s*\{/.test(modifiedLine)) {
      // บรรทัดเปิด block => เว้นบรรทัดก่อนถ้าไม่ใช่บรรทัดแรก
      if (formattedBlockLines.length > 0) {
        formattedBlockLines.push('');
      }
      formattedBlockLines.push(`\t${modifiedLine}`);
    } else if (modifiedLine === '}') {
      // ปิด block => indent 1 tab
      formattedBlockLines.push(`\t${modifiedLine}`);
    } else {
      // อื่น ๆ => indent 2 tab
      modifiedLine = modifiedLine.replace(/([\w-]+)\[\s*(.*?)\s*\]/g, '$1[$2]');
      formattedBlockLines.push(`\t\t${modifiedLine}`);
    }
  }

  // -----------------------------------------------------------------------------
  // 9) สร้างส่วน directive (@scope, @bind) + constBlocks + .box
  // -----------------------------------------------------------------------------
  const finalLines: string[] = [];

  // 9.1) @scope
  for (const s of scopeLines) {
    finalLines.push(`\t${s}`);
  }

  // 9.2) @bind
  for (const b of bindLines) {
    finalLines.push(`\t${b}`);
  }

  // ถ้ามี directive => เว้น 1 บรรทัด
  if (scopeLines.length > 0 || bindLines.length > 0) {
    finalLines.push('');
  }

  // 9.3) ใส่ const blocks
  formattedConstBlocks.forEach((block, index) => {
    // ก่อนบล็อก @const แต่ละตัว (ยกเว้นตัวแรก) เว้น 1 บรรทัด
    if (index > 0) {
      finalLines.push('');
    }
    finalLines.push(...block);
  });

  // ถ้ามี const blocks => เว้น 1 บรรทัด
  if (formattedConstBlocks.length > 0) {
    finalLines.push('');
  }

  // 9.4) ใส่ .box {...} (formattedBlockLines)
  finalLines.push(...formattedBlockLines);

  const finalBlock = finalLines.join('\n');

  // -----------------------------------------------------------------------------
  // 10) ประกอบเป็น styled<...>` + finalBlock + `
  // -----------------------------------------------------------------------------
  const newStyledBlock = `${newPrefix}\`\n${finalBlock}\n\``;

  // แทนที่ของเดิมใน sourceCode ด้วยบล็อกใหม่
  return sourceCode.replace(fullMatch, newStyledBlock);
}
