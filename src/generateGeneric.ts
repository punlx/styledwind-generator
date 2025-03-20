export function generateGeneric(sourceCode: string): string {
  // -------------------------------------------------------------------------
  // 1) หา styled`...` (บล็อกแรก) ด้วย Regex ที่จับ prefix + เนื้อหาใน backtick
  // -------------------------------------------------------------------------
  const styledRegex = /\b(styled\s*(?:<[^>]*>)?)`([^`]*)`/gs;
  const match = styledRegex.exec(sourceCode);
  if (!match) return sourceCode;

  const fullMatch = match[0]; // ตัวเต็ม "styled ... ` ... `"
  const prefix = match[1]; // "styled" หรือ "styled<...>"
  const templateContent = match[2]; // โค้ดภายใน backtick

  // -------------------------------------------------------------------------
  // 2) จับ class .xxx {...} เพื่อสร้าง classMap (เก็บ $xxx[...] เพื่อใส่ใน Generic)
  // -------------------------------------------------------------------------
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

      if (pseudoFn === 'screen' || pseudoFn === 'container') {
        continue; // ไม่ใส่ใน generic
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

  // -------------------------------------------------------------------------
  // 3) แยก directive (@scope, @bind) ออกจากเนื้อหา เพื่อ:
  //    - เก็บ @bind ไว้สร้าง type ใหม่ใน generic
  //    - เก็บ @scope/@bind ไว้จัด format ด้านบน
  //    - ส่วนที่เหลือคือ .box {...} นำไปจัด indent ด้วย logic เดิม
  // -------------------------------------------------------------------------
  const lines = templateContent.split('\n');
  const scopeLines: string[] = [];
  const bindLines: string[] = [];
  const normalLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // บรรทัดว่าง -> ข้าม (หรือจะเก็บไว้ก็ได้ แต่ในตัวอย่างเลือกทิ้ง)
      continue;
    }
    if (trimmed.startsWith('@scope ')) {
      scopeLines.push(trimmed);
    } else if (trimmed.startsWith('@bind ')) {
      bindLines.push(trimmed);
    } else {
      normalLines.push(trimmed);
    }
  }

  // -------------------------------------------------------------------------
  // 4) สร้าง "bindMap" -> key จาก @bind => { key: [] }
  //    แล้วรวม bindMap + classMap => finalGenericObj
  // -------------------------------------------------------------------------
  const bindKeys: string[] = [];
  for (const bindLine of bindLines) {
    // ตัวอย่าง "@bind box1and2 .box1 .box2" => split => ["@bind", "box1and2", ".box1", ".box2"]
    const tokens = bindLine.split(/\s+/);
    if (tokens.length > 1) {
      const bindKey = tokens[1];
      bindKeys.push(bindKey);
    }
  }

  // 4.1) สร้าง entries ของ @bind (ว่าง [])
  //      เรียงตามลำดับที่พบ
  const bindEntries = bindKeys.map((key) => {
    return `${key}: []`;
  });

  // 4.2) สร้าง entries ของ classMap (เหมือน logic เดิม)
  const classEntries = Object.keys(classMap).map((clsName) => {
    const arr = Array.from(classMap[clsName]);
    const arrLiteral = arr.map((a) => `"${a}"`).join(', ');
    return `${clsName}: [${arrLiteral}]`;
  });

  // 4.3) รวม bindEntries มาก่อน + classEntries ทีหลัง
  const allEntries = [...bindEntries, ...classEntries];
  // สร้างเป็น "{ key1: []; key2: []; class1: [...]; ... }"
  const finalGeneric = `{ ${allEntries.join('; ')} }`;

  // -------------------------------------------------------------------------
  // 5) ใส่ finalGeneric ลงไปใน prefix (styled<...>)
  // -------------------------------------------------------------------------
  let newPrefix: string;
  if (prefix.includes('<')) {
    newPrefix = prefix.replace(/<[^>]*>/, `<${finalGeneric}>`);
  } else {
    newPrefix = prefix + `<${finalGeneric}>`;
  }

  // -------------------------------------------------------------------------
  // 6) จัดฟอร์แมตส่วน .box {...} ด้วย logic เดิม
  // -------------------------------------------------------------------------
  const formattedBlockLines: string[] = [];
  for (const line of normalLines) {
    // แทนที่ ".xxx {"
    let modifiedLine = line.replace(/\.(\w+)(?:\([^)]*\))?\s*\{/, (m, className) => {
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
      // จัด spacing ภายใน [ ... ]
      modifiedLine = modifiedLine.replace(/([\w-]+)\[\s*(.*?)\s*\]/g, '$1[$2]');
      formattedBlockLines.push(`\t\t${modifiedLine}`);
    }
  }

  // -------------------------------------------------------------------------
  // 7) รวม directive (scope + bind) ด้านบน + บรรทัดว่าง + formattedBlock
  // -------------------------------------------------------------------------
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

  // ใส่ block ที่จัดแล้ว
  finalLines.push(...formattedBlockLines);

  const finalBlock = finalLines.join('\n');

  // -------------------------------------------------------------------------
  // 8) ประกอบเป็น styled<...>` + finalBlock + `
  // -------------------------------------------------------------------------
  const newStyledBlock = `${newPrefix}\`\n${finalBlock}\n\``;

  // แทนที่ของเดิมใน sourceCode ด้วยบล็อกใหม่
  return sourceCode.replace(fullMatch, newStyledBlock);
}
