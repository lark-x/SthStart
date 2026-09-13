export function InputLabel({ htmlFor, children, hint }: { htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">
      <span>{children}</span>
      {hint && <span className="ml-1 font-normal text-fg-subtle">{hint}</span>}
    </label>
  );
}
