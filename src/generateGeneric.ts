// generateGeneric.ts
export function generateGeneric(sourceCode: string): string {
  // 1) หา styled`...` (บล็อกแรก)
  //    *ถ้าต้องการรองรับหลายบล็อกในไฟล์เดียว อาจใช้ while loop แทน .exec() ครั้งเดียว
  const styledRegex = /\b(styled\s*(?:<[^>]*>)?)`([^`]*)`/gs;
  const match = styledRegex.exec(sourceCode);
  if (!match) return sourceCode;

  // เก็บค่า prefix กับเนื้อหาใน backtick
  const fullMatch = match[0]; // "styled` ... `"
  const prefix = match[1]; // "styled" หรือ "styled<...>"
  const templateContent = match[2]; // เนื้อหาใน backtick

  // 2) หา .className { ... } พร้อมดึงเนื้อหาข้างใน
  const classRegex = /\.(\w+)(?:\([^)]*\))?\s*\{([^}]*)\}/g;
  const classMap: Record<string, Set<string>> = {};

  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRegex.exec(templateContent)) !== null) {
    const clsName = classMatch[1];
    const innerContent = classMatch[2];

    if (!classMap[clsName]) {
      classMap[clsName] = new Set();
    }

    // 2.1) จับ pseudo function (hover, focus, active, ฯลฯ) ยกเว้น screen, container
    //      หากพบ $xxx[...] ข้างใน ก็เก็บเป็น $xxx-hover, $xxx-focus ฯลฯ
    const pseudoFnRegex =
      /\b(hover|focus|active|focus-visible|focus-within|target|before|after|screen|container)\s*\(([^)]*)\)/g;
    let fnMatch: RegExpExecArray | null;

    while ((fnMatch = pseudoFnRegex.exec(innerContent)) !== null) {
      const pseudoFn = fnMatch[1]; // เช่น 'hover', 'focus', 'screen', ...
      const inside = fnMatch[2]; // ข้อความข้างในวงเล็บ

      // ถ้าเป็น screen, container ให้ข้าม (ไม่ generate type)
      if (pseudoFn === 'screen' || pseudoFn === 'container') {
        continue;
      }

      // หา $xxx[...] ภายใน (ใช้ (\$[\w-]+)\[ เพื่อจับทั้ง $ และชื่อ style)
      const styleMatches = [...inside.matchAll(/(\$[\w-]+)\[/g)].map((m) => m[1]);
      // ต่อท้ายชื่อด้วย -hover / -focus / -before / -after ฯลฯ
      for (const styleName of styleMatches) {
        const newName = `${styleName}-${pseudoFn}`; // เช่น $bg-hover
        classMap[clsName].add(newName);
      }
    }

    // 2.2) จับ $xxx[...] ที่ *นอก* pseudo function
    //      วิธีง่าย ๆ คือทำสำเนา innerContent มาลบฟังก์ชัน pseudo ทิ้ง แล้วค่อยหา
    //      เพื่อไม่ให้จับซ้ำซ้อนกัน
    const pseudoFnRegexForRemove =
      /\b(?:hover|focus|active|focus-visible|focus-within|target|before|after|screen|container)\s*\(([^)]*)\)/g;
    const contentWithoutFn = innerContent.replace(pseudoFnRegexForRemove, '');

    // หา $xxx[...] ที่โผล่ตรง ๆ ข้างนอก
    const directMatches = [...contentWithoutFn.matchAll(/(\$[\w-]+)\[/g)].map((m) => m[1]);
    for (const styleName of directMatches) {
      classMap[clsName].add(styleName);
    }
  }

  // 3) สร้าง Generic object เช่น { box: ["$bg-hover", ...], card: [...], ... }
  const entries = Object.keys(classMap).map((clsName) => {
    const arr = Array.from(classMap[clsName]);
    const arrLiteral = arr.map((a) => `"${a}"`).join(', ');
    return `${clsName}: [${arrLiteral}]`;
  });

  // รวมเป็น { box: [...], card: [...] }
  const generatedGeneric = `{ ${entries.join(', ')} }`;

  // 4) ถ้า prefix เคยมี Generics อยู่แล้วให้ replace ถ้าไม่มีก็ใส่เพิ่ม
  let newPrefix: string;
  if (prefix.includes('<')) {
    // มี generics อยู่แล้ว เช่น styled<{...}>
    newPrefix = prefix.replace(/<[^>]*>/, `<${generatedGeneric}>`);
  } else {
    // ไม่มี generics => ใส่เพิ่มไปเลย
    newPrefix = prefix + `<${generatedGeneric}>`;
  }

  // 5) จัด format block เดิม (templateContent) ทีละบรรทัด (ตามโค้ดเดิม)
  const lines = templateContent.split('\n');
  const formattedLines: string[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return; // ตัดบรรทัดว่างทิ้ง

    // ปรับบรรทัด .xxx { => .xxx {
    let modifiedLine = trimmed.replace(/\.(\w+)(?:\([^)]*\))?\s*\{/, (matchStr, className) => {
      return `.${className} {`;
    });

    // ถ้าเป็นบรรทัดเปิด block class => เว้นบรรทัดก่อน
    if (/^\.\w+\s*\{/.test(modifiedLine)) {
      if (formattedLines.length > 0) {
        formattedLines.push('');
      }
      formattedLines.push(`\t${modifiedLine}`);
    }
    // ถ้าปิดบล็อค => แค่ indent เดียว
    else if (modifiedLine === '}') {
      formattedLines.push(`\t${modifiedLine}`);
    }
    // นอกนั้น => indent สองชั้น
    else {
      // ตรงนี้ก็ replace [...] ไว้สำหรับจัด spacing ภายใน [... ]
      // ไม่ตัดเครื่องหมาย $ ทิ้ง แค่จัด format
      modifiedLine = modifiedLine.replace(/([\w-]+)\[\s*(.*?)\s*\]/g, '$1[$2]');
      formattedLines.push(`\t\t${modifiedLine}`);
    }
  });

  // ประกอบกลับเป็น string
  const cleanedContent = formattedLines.join('\n');

  // 6) ประกอบเป็น styled<Generic>` ... `
  const newStyledBlock = `${newPrefix}\`\n${cleanedContent}\n\``;

  // 7) replace บล็อคเก่าใน source ด้วยบล็อคใหม่
  return sourceCode.replace(fullMatch, newStyledBlock);
}
