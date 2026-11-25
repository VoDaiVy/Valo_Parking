import { policyLines, headingAt } from './policySections';
import { Fragment } from 'react';

// React escapes all text; policy HTML is never inserted into the document.
function inline(text, depth = 0) {
  if (depth > 8) return text;
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|!?\[[^\]]*\]\([^\s)]+\))/g;
  return text.split(pattern).map((part, index) => {
    const key = index;
    if (/^`[^`]+`$/.test(part)) return <code key={key} className="rounded bg-gray-100 px-1 font-mono text-sm">{part.slice(1, -1)}</code>;
    if (/^(\*\*[^*]+\*\*|__[^_]+__)$/.test(part)) return <strong key={key}>{inline(part.slice(2, -2), depth + 1)}</strong>;
    if (/^(\*[^*\n]+\*|_[^_\n]+_)$/.test(part)) return <em key={key}>{inline(part.slice(1, -1), depth + 1)}</em>;
    const link = part.match(/^(!?)\[([^\]]*)\]\(([^\s)]+)\)$/);
    if (link) {
      const [, image, label, href] = link;
      if (image || !/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href)) return <Fragment key={key}>{label}</Fragment>;
      return <a key={key} href={href} className="font-semibold text-gold-deep underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">{label}</a>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function PolicySectionLabel({ title }) { return inline(title.replace(/!?\[([^\]]*)\]\([^\s)]+\)/g, '$1')); }

export default function PolicyMarkdown({ content }) {
  const lines = policyLines(content);
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const key = i;
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="overflow-x-auto rounded-2xl bg-gray-50 p-4 text-sm"><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = headingAt(lines, i);
    if (heading) {
      const Heading = `h${heading.level}`;
      blocks.push(<Heading key={key} id={`policy-section-${i}`} tabIndex={-1} className="scroll-mt-24 pt-3 text-lg font-extrabold leading-snug text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">{inline(heading.title)}</Heading>);
      i += heading.count;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { blocks.push(<hr key={key} className="border-gray-200" />); i++; continue; }
    const list = line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
    if (list) {
      const ordered = Boolean(list[2]);
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(<li key={i}>{inline(item[3])}</li>);
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={key} start={ordered ? Number(list[2]) : undefined} className={`space-y-2 pl-6 ${ordered ? 'list-decimal' : 'list-disc'} marker:text-gold-deep`}>{items}</List>);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key} className="rounded-r-xl border-l-2 border-gold bg-gold/5 px-4 py-3 text-gray-700 whitespace-pre-wrap">{inline(quote.join('\n'))}</blockquote>);
      continue;
    }
    const paragraph = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !headingAt(lines, i) && !/^\s*(#{1,6}\s|>|```|[-+*]\s|\d+[.)]\s)/.test(lines[i]) && !/^\s*(={3,}|-{3,}|\*{3,})\s*$/.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={key} className="whitespace-pre-wrap">{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="space-y-3 [overflow-wrap:anywhere]">{blocks}</div>;
}
