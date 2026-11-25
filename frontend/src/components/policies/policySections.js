export const policyLines = (content) => String(content || '').replace(/\r\n?/g, '\n').split('\n');

export function headingAt(lines, index) {
  const line = lines[index];
  const markdown = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
  if (markdown) return { title: markdown[2], level: Math.min(markdown[1].length + 1, 6), count: 1 };
  if (line.trim() && index + 1 < lines.length && /^\s*(={3,}|-{3,})\s*$/.test(lines[index + 1])) return { title: line, level: 2, count: 2 };
  // Standalone numbered section titles, excluding consecutive ordered-list items.
  if (/^\s*(?:\d+(?:\.\d+)*[.)]?|[IVX]+[.)])\s+\S/.test(line) && line.trim().length <= 120 &&
      (index === 0 || !lines[index - 1].trim()) && index + 1 < lines.length && !lines[index + 1].trim()) {
    return { title: line.trim(), level: 2, count: 1 };
  }
  return null;
}

export function getPolicySections(content) {
  const lines = policyLines(content);
  const sections = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = headingAt(lines, i);
    if (heading) {
      sections.push({ ...heading, id: `policy-section-${i}`, line: i });
      i += heading.count - 1;
    }
  }
  return sections;
}

