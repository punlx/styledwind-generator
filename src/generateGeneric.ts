export function generateGeneric(sourceCode: string): string {
  const styledRegex = /\b(styled\s*(?:<[^>]*>)?)`([^`]*)`/gs;
  const match = styledRegex.exec(sourceCode);
  if (!match) return sourceCode;

  const fullMatch = match[0];
  const prefix = match[1];
  const templateContent = match[2];

  const classRegex = /\.(\w+)(?:\([^)]*\))?\s*\{([^}]*)\}/g;
  const classMap: Record<string, Set<string>> = {};

  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRegex.exec(templateContent)) !== null) {
    const clsName = classMatch[1];
    const innerContent = classMatch[2];

    // ใช้ regex ใหม่เพื่อจับ abbr ที่มี -
    const abbrInside = [...innerContent.matchAll(/([\w-]+)\[/g)].map((m) => m[1]);

    if (!classMap[clsName]) {
      classMap[clsName] = new Set();
    }
    abbrInside.forEach((a) => classMap[clsName].add(a));
  }

  const entries = Object.keys(classMap).map((clsName) => {
    const arr = Array.from(classMap[clsName]);
    const arrLiteral = arr.map((a) => `"${a}"`).join(', ');
    return `${clsName}: [${arrLiteral}]`;
  });

  const generatedGeneric = `{ ${entries.join(', ')} }`;

  let newPrefix: string;
  if (prefix.includes('<')) {
    newPrefix = prefix.replace(/<[^>]*>/, `<${generatedGeneric}>`);
  } else {
    newPrefix = prefix + `<${generatedGeneric}>`;
  }

  const lines = templateContent.split('\n');
  const formattedLines: string[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let modifiedLine = trimmed.replace(/\.(\w+)(?:\([^)]*\))?\s*\{/, (matchStr, className) => {
      return `.${className} {`;
    });

    if (/^\.\w+\s*\{/.test(modifiedLine)) {
      if (formattedLines.length > 0) {
        formattedLines.push('');
      }
      formattedLines.push(`\t${modifiedLine}`);
    } else if (modifiedLine === '}') {
      formattedLines.push(`\t${modifiedLine}`);
    } else {
      modifiedLine = modifiedLine.replace(/([\w-]+)\[\s*(.*?)\s*\]/g, '$1[$2]');
      formattedLines.push(`\t\t${modifiedLine}`);
    }
  });

  const cleanedContent = formattedLines.join('\n');
  const newStyledBlock = `${newPrefix}\`\n${cleanedContent}\n\``;

  return sourceCode.replace(fullMatch, newStyledBlock);
}
