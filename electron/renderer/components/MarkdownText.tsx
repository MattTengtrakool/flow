export function MarkdownText(props: { text: string }) {
  const lines = props.text.split('\n');
  return (
    <div className="markdown-text">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ')) {
          return <li key={index}>{trimmed.slice(2)}</li>;
        }
        if (trimmed.startsWith('## ')) {
          return <h3 key={index}>{trimmed.slice(3)}</h3>;
        }
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}
