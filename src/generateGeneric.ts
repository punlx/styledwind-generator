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
  // 2) เราจะเตรียมโครงสร้าง 2 ส่วน:
  //    - classMap: เก็บ Set ของ $xxx สำหรับ ".boxX" (เหมือนเดิม)
  //    - constMap: เก็บ Set ของ $xxx สำหรับ "@const cName" (ของใหม่)
  // -----------------------------------------------------------------------------
  const classMap: Record<string, Set<string>> = {};
  const constMap: Record<string, Set<string>> = {};

  // -----------------------------------------------------------------------------
  // 3) เราสร้างฟังก์ชันช่วย parse $xxx ในเนื้อหา (รวม pseudo):
  //    (คือ logic เดิม ๆ ที่เคยทำใน classRegex, แต่สรุปเป็นฟังก์ชัน)
  // -----------------------------------------------------------------------------
  function parseStylesIntoSet(content: string, targetSet: Set<string>) {
    // 3.1) จับ pseudo function ยกเว้น screen, container
    //      รูปแบบ: hover(...), focus(...), etc.
    const pseudoFnRegex =
      /\b(hover|focus|active|focus-visible|focus-within|target|before|after|screen|container)\s*\(([^)]*)\)/g;
    let fnMatch: RegExpExecArray | null;
    while ((fnMatch = pseudoFnRegex.exec(content)) !== null) {
      const pseudoFn = fnMatch[1];
      const inside = fnMatch[2];

      if (pseudoFn === 'screen' || pseudoFn === 'container') {
        continue; // ข้าม
      }
      // หา $xxx[...] ภายใน pseudo (แต่ต้องกรอง --$xxx)
      const styleMatches = [...inside.matchAll(/(\$[\w-]+)\[/g)]
        .filter((m) => {
          const idx = m.index || 0;
          // ถ้า 2 ตัวอักษรก่อนหน้าคือ '--' ให้ข้าม
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

    // 3.2) จับ $xxx[...] นอก pseudo
    const pseudoFnRegexForRemove =
      /\b(?:hover|focus|active|focus-visible|focus-within|target|before|after|screen|container)\s*\(([^)]*)\)/g;
    const contentWithoutFn = content.replace(pseudoFnRegexForRemove, '');

    // หา $xxx[...] นอก pseudo (แต่ต้องกรอง --$xxx)
    const directMatches = [...contentWithoutFn.matchAll(/(\$[\w-]+)\[/g)]
      .filter((m) => {
        const idx = m.index || 0;
        // ถ้า 2 ตัวอักษรก่อนหน้าคือ '--' ให้ข้าม
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
  // 4) Parse @const ... { ... } ด้วย Regex แยกต่างหาก
  //    แล้วใส่ข้อมูลใน constMap
  // -----------------------------------------------------------------------------
  // ตัวอย่าง: @const cName { ... } => เราดึง cName และ ... ไป parse
  // หมายเหตุ: ถ้าไฟล์มีหลาย @const ติด ๆ กัน logic นี้จะเจอทั้งหมด
  {
    const constRegex = /@const\s+([\w-]+)\s*\{([^}]*)\}/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = constRegex.exec(templateContent)) !== null) {
      const constName = cMatch[1]; // เช่น "bgRed"
      const constBody = cMatch[2]; // เนื้อหาใน { ... }
      if (!constMap[constName]) {
        constMap[constName] = new Set();
      }

      // parse pseudo + $xxx[...] ใน constBody
      parseStylesIntoSet(constBody, constMap[constName]);
    }
  }

  // -----------------------------------------------------------------------------
  // 5) Parse .xxx { ... } ด้วย Regex (ของเดิม) เพื่อเก็บข้อมูลลง classMap
  //    พร้อมตรวจ @use ... เพื่อ merge ข้อมูลจาก constMap เข้าไป
  // -----------------------------------------------------------------------------
  {
    const classRegex = /\.(\w+)(?:\([^)]*\))?\s*\{([^}]*)\}/g;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classRegex.exec(templateContent)) !== null) {
      const clsName = classMatch[1]; // เช่น "box1"
      const innerContent = classMatch[2]; // เนื้อหาภายใน { ... }

      if (!classMap[clsName]) {
        classMap[clsName] = new Set();
      }

      // (A) ตรวจหา @use ... ใน innerContent
      //     ตัวอย่าง: "@use cRed dFlex"
      //     => ให้เรา split เอาชื่อ const
      {
        // Regex จับ: @use\s+([^\{\}\n]+) -> ข้อความหลัง @use
        // แล้ว split space => ได้ ["cRed","dFlex"]
        const useRegex = /@use\s+([^\{\}\n]+)/g;
        let useMatch: RegExpExecArray | null;
        while ((useMatch = useRegex.exec(innerContent)) !== null) {
          const usedConstsLine = useMatch[1]; // "cRed dFlex"
          const usedConstNames = usedConstsLine.split(/\s+/).filter(Boolean);
          // เอาทุก constName ไป merge set
          for (const cname of usedConstNames) {
            if (constMap[cname]) {
              for (const val of constMap[cname]) {
                classMap[clsName].add(val);
              }
            }
          }
        }
      }

      // (B) parse `$xxx[...]` และ pseudo function ในตัว innerContent เอง (เหมือนเดิม)
      parseStylesIntoSet(innerContent, classMap[clsName]);
    }
  }

  // -----------------------------------------------------------------------------
  // 6) ตอนนี้ classMap มี set ของ $xxx จากทั้ง direct (ใน .box) และ from @use
  //    ต่อไปเหมือนเดิม: parse directive @scope, @bind, @const => จัด format
  //    (ด้านล่างส่วน "format" เราแก้ code เล็กน้อยให้ใช้ structure เดิม)
  // -----------------------------------------------------------------------------

  // แยกบรรทัดทั้งหมด
  const lines = templateContent.split('\n');
  const scopeLines: string[] = [];
  const bindLines: string[] = [];
  const constBlocks: string[][] = []; // เก็บ block เดิมเพื่อนำไป format
  const normalLines: string[] = [];

  // ฟังก์ชันช่วยจัด spacing directive
  function normalizeDirectiveLine(line: string) {
    const tokens = line.split(/\s+/).filter(Boolean);
    return tokens.join(' ');
  }

  // วน loop แยก @scope, @bind, @const, ฯลฯ
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
        // อ่าน block @const ... { ... } จนเจอ '}'
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

      // อื่น ๆ => normal
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
    // "@bind box1and2 .box1 .box2" -> [ "@bind", "box1and2", ".box1", ".box2" ]
    if (tokens.length > 1) {
      bindKeys.push(tokens[1]); // "box1and2"
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

  // รวม bindEntries + classEntries
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
  // 10) ฟอร์แมต @const block + .box block + directive เหมือนเดิม
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

  // 10.2) format .box {...} (normalLines) => เหมือน logic เดิม
  const formattedBlockLines: string[] = [];
  for (const line of normalLines) {
    let modifiedLine = line.replace(/\.(\w+)(?:\([^)]*\))?\s*\{/, (m, cName) => `.${cName} {`);
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

  // 10.3) รวมทุก directive + constBlocks + normal .box
  const finalLines: string[] = [];

  // @scope
  for (const s of scopeLines) {
    finalLines.push(`\t${s}`);
  }
  // @bind
  for (const b of bindLines) {
    finalLines.push(`\t${b}`);
  }
  // ถ้ามี directive => เว้น 1 บรรทัด
  if (scopeLines.length > 0 || bindLines.length > 0) {
    finalLines.push('');
  }

  // const blocks
  formattedConstBlocks.forEach((block, idx) => {
    if (idx > 0) {
      finalLines.push('');
    }
    finalLines.push(...block);
  });
  if (formattedConstBlocks.length > 0) {
    finalLines.push('');
  }

  // .box block
  finalLines.push(...formattedBlockLines);

  // ประกอบ
  const finalBlock = finalLines.join('\n');

  // -----------------------------------------------------------------------------
  // 11) Replace ลงใน sourceCode
  // -----------------------------------------------------------------------------
  const newStyledBlock = `${newPrefix}\`\n${finalBlock}\n\``;
  return sourceCode.replace(fullMatch, newStyledBlock);
}
