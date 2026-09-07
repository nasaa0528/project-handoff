/** An id, a hash, a timestamp: monospace, wrapping anywhere, selectable in one go. */
export function Mono({ children, className = "" }: { children: string; className?: string }) {
  return (
    <code className={`font-mono text-[0.8125rem] wrap-anywhere select-all ${className}`}>{children}</code>
  );
}

/** A 64-hex hash shortened for a glance, with the whole thing on hover and on copy. */
export function ShortHash({ value }: { value: string }) {
  const short = value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
  return (
    <code
      className="font-mono text-[0.8125rem] cursor-help"
      title={value}
      onCopy={(event) => {
        event.preventDefault();
        event.clipboardData.setData("text/plain", value);
      }}
    >
      {short}
    </code>
  );
}
