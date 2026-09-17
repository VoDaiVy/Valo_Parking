import { Fragment } from 'react';

// Render only the formatting used in chat replies. React escapes all text,
// including HTML supplied by the model; no HTML parser is involved.
const inlinePattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;

function inline(text) {
  return text.split(inlinePattern).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__')))
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_')))
      return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export default function AIMessageMarkdown({ text }) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{paragraph.map((line, index) => <Fragment key={index}>{index > 0 && <br/>}{inline(line)}</Fragment>)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    }
    list = null;
  };

  for (const line of lines) {
    const match = line.match(/^\s{0,3}(?:([-*+])|(\d+)\.)\s+(.+)$/);
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    if (match) {
      flushParagraph();
      const ordered = Boolean(match[2]);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
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
