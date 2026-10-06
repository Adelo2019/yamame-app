// 共通の部品
import type { ReactNode } from 'react';

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-600">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-stone-200 bg-white p-3 ${className}`}>{children}</div>;
}

export function Button({
  children, onClick, variant = 'primary', disabled, type = 'button', className = '',
}: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean; type?: 'button' | 'submit'; className?: string;
}) {
  const styles = {
    primary: 'bg-[#0f3d3e] text-white active:bg-[#0a2b2c]',
    secondary: 'border border-stone-300 bg-white text-stone-800 active:bg-stone-100',
    danger: 'border border-red-200 bg-white text-red-700 active:bg-red-50',
    ghost: 'text-[#0f3d3e] active:bg-stone-100',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value, options, onChange,
}: { value: T | null; options: { value: T; label: string }[]; onChange: (v: T | null) => void }) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(value === o.value ? null : o.value)}
          className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold ${
            value === o.value ? 'border-[#0f3d3e] bg-[#0f3d3e] text-white' : 'border-stone-300 bg-white text-stone-700'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NumberInput({
  value, onChange, unit, placeholder, decimal = false, className = '',
}: {
  value: string; onChange: (v: string) => void; unit: string; placeholder?: string; decimal?: boolean; className?: string;
}) {
  return (
    <div className={`flex items-center rounded-lg border border-stone-300 bg-white focus-within:border-[#0f3d3e] ${className}`}>
      <input
        type="text" inputMode={decimal ? 'decimal' : 'numeric'} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, ''))}
        className="w-full min-w-0 bg-transparent px-3 py-2.5 text-lg tabular-nums outline-none"
      />
      <span className="pr-3 text-sm text-stone-500">{unit}</span>
    </div>
  );
}

export function Badge({ children, tone = 'stone' }: { children: ReactNode; tone?: 'stone' | 'green' | 'amber' | 'blue' }) {
  const t = {
    stone: 'bg-stone-100 text-stone-700', green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800', blue: 'bg-sky-100 text-sky-800',
  }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{message}</div>;
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed inset-x-0 bottom-24 z-30 flex justify-center px-4">
      <div className="rounded-full bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">{message}</div>
    </div>
  );
}
