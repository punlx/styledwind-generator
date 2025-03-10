export function generateGeneric(sourceCode: string): string {
  // ดึง block styled...`...`
  const styledRegex = /\b(styled\s*(?:<[^>]*>)?)`([^`]*)`/gs;
  const match = styledRegex.exec(sourceCode);
  if (!match) return sourceCode;

  const fullMatch = match[0];
  const prefix = match[1]; // "styled" หรือ "styled<...>"
  const templateContent = match[2]; // เนื้อใน backtick

  // แก้ไข regex ให้ครอบคลุมกรณีที่มีวงเล็บตามหลังชื่อ class
  //
  // ตัวอย่าง:
  //   .test(เพิ่ม 1 space){
  //     ...
  //   }
  //
  // เราต้องการให้ capture ได้เป็น:
  //   Group1 -> ชื่อ class เช่น test
  //   Group2 -> เนื้อใน {...}
  //
  // โดยจะตัดส่วนวงเล็บทิ้ง ไม่เก็บไว้
  //
  //  \.(\w+)           => จับ .{ชื่อclass}
  //  (?:\([^)]*\))?    => จับ ( ... ) แบบ optional (0 หรือ 1 ครั้ง) โดยไม่เก็บใน capture group
  //  \s*\{([^}]*)\}    => จากนั้นหา { ... } แล้วจับเฉพาะในวงเล็บเก็บไว้ใน group2
  //
  const classRegex = /\.(\w+)(?:\([^)]*\))?\s*\{([^}]*)\}/g;

  // สร้าง map สำหรับเก็บข้อมูล abbr เช่น bg[...] / c[...] / bd[...] แต่ละ class
  const classMap: Record<string, Set<string>> = {};

  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRegex.exec(templateContent)) !== null) {
    const clsName = classMatch[1]; // ชื่อ class เช่น test
    const innerContent = classMatch[2]; // เนื้อใน {...}

    // หา abbr เช่น bg[ ... ], c[ ... ], bd[ ... ] ใน block
    // (\w+)\[ => เช่น bg[ / c[ / bd[
    const abbrInside = [...innerContent.matchAll(/(\w+)\[/g)].map((m) => m[1]);

    if (!classMap[clsName]) {
      classMap[clsName] = new Set();
    }
    abbrInside.forEach((a) => classMap[clsName].add(a));
  }

  // สร้าง object generic
  // เช่น { test: ["bg","c","bd"], test2: ["bg"], test3: ["bg"] }
  const entries = Object.keys(classMap).map((clsName) => {
    const arr = Array.from(classMap[clsName]);
    const arrLiteral = arr.map((a) => `"${a}"`).join(', ');
    return `${clsName}: [${arrLiteral}]`;
  });
  const generatedGeneric = `{ ${entries.join(', ')} }`;

  // เช็คว่าที่ prefix (styled<...> หรือ styled) มี generic แล้วหรือยัง ถ้ามีก็แทนที่
  // ถ้าไม่มี ก็เพิ่ม <{ ... }>
  let newPrefix: string;
  if (prefix.includes('<')) {
    newPrefix = prefix.replace(/<[^>]*>/, `<${generatedGeneric}>`);
  } else {
    newPrefix = prefix + `<${generatedGeneric}>`;
  }

  // ฟอร์แมตใหม่ (split / trim / indent ฯลฯ)
  // โดยในขั้นตอนนี้เราจะเอาวงเล็บหลัง .className ทิ้งไปด้วย
  const lines = templateContent.split('\n');
  const formattedLines: string[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      // ถ้าเป็นบรรทัดว่างก็ข้ามไปเลย (ไม่ต้องทำอะไร)
      return;
    }

    // ลบวงเล็บในรูปแบบ .className(....) => .className
    // และให้เว้นวรรคก่อน { เช่น .className {
    let modifiedLine = trimmed.replace(/\.(\w+)(?:\([^)]*\))?\s*\{/, (matchStr, className) => {
      return `.${className} {`;
    });

    // เช็คว่าถ้าเป็นบรรทัดเปิด class (".something {") ให้ indent แค่ 1 tab
    // ถ้าเป็นบรรทัดปิด class ("}") ให้ indent 1 tab
    // นอกนั้นให้ indent 2 tab
    if (/^\.\w+\s*\{/.test(modifiedLine)) {
      // เปิด block class
      if (formattedLines.length > 0) {
        // ถ้าไม่ใช่ตัวแรก ให้ใส่บรรทัดว่างขั้น
        formattedLines.push('');
      }
      formattedLines.push(`\t${modifiedLine}`);
    } else if (modifiedLine === '}') {
      // ปิด block
      formattedLines.push(`\t${modifiedLine}`);
    } else {
      // property ภายใน block
      // ลบช่องว่างเกินที่อาจอยู่ใน abbr เช่น bg[ red ] => bg[red]
      modifiedLine = modifiedLine.replace(/(\w+)\[\s*(.*?)\s*\]/g, '$1[$2]');
      formattedLines.push(`\t\t${modifiedLine}`);
    }
  });

  const cleanedContent = formattedLines.join('\n');

  // สร้างข้อความสุดท้าย
  const newStyledBlock = `${newPrefix}\`\n${cleanedContent}\n\``;
  return sourceCode.replace(fullMatch, newStyledBlock);
}
