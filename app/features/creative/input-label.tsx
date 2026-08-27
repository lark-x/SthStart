export function InputLabel({ htmlFor, children, hint }: { htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-[#18201d]">
      <span>{children}</span>
      {hint && <span className="ml-1 font-normal text-[#89908a]">{hint}</span>}
    </label>
  );
}
