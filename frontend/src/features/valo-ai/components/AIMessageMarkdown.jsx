import { Fragment } from 'react';
import { Link } from 'react-router-dom';

// Render only the formatting used in chat replies. React escapes all text,
// including HTML supplied by the model; no HTML parser is involved.
const inlinePattern = /(\\[\\`*_[\](){}#+.!>\-]|\[[^\]\n]+\]\([^\s)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|(?<![\\\p{L}\p{N}_@.])__[^_\n]+__(?![\p{L}\p{N}_@.])|\*[^*\n]+\*|(?<![\\\p{L}\p{N}_@.])_[^_\n]+(?<!\\)_(?![\p{L}\p{N}_@.]))/gu;
const unescapeText = text => text.replace(/\\([\\`*_[\](){}#+.!>\-])/g, '$1');

function inline(text, allowedLinks) {
  return text.split(inlinePattern).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return allowedLinks.has(link[2]) ? <Link key={index} to={link[2]}>{unescapeText(link[1])}</Link> : <Fragment key={index}>{unescapeText(link[1])}</Fragment>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__')))
      return <strong key={index}>{unescapeText(part.slice(2, -2))}</strong>;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_')))
      return <em key={index}>{unescapeText(part.slice(1, -1))}</em>;
    return <Fragment key={index}>{unescapeText(part)}</Fragment>;
  });
}

export default function AIMessageMarkdown({ text, links = [] }) {
  const allowedLinks = new Set(links.map(link => link.url));
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{paragraph.map((line, index) => <Fragment key={index}>{index > 0 && <br/>}{inline(line, allowedLinks)}</Fragment>)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{inline(item, allowedLinks)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length} start={list.start}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    }
    list = null;
  };

  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(<p key={blocks.length}><strong>{inline(heading[1], allowedLinks)}</strong></p>);
      continue;
    }
    const match = line.match(/^\s{0,3}(?:([-*+])|(\d+)\.)\s+(.+)$/);
    if (!line.trim()) { flushParagraph(); continue; }
    if (match) {
      flushParagraph();
      const ordered = Boolean(match[2]);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, start: Number(match[2]) || 1, items: [] };
      list.items.push(match[3]);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return <div className="valo-ai-markdown">{blocks}</div>;
}
