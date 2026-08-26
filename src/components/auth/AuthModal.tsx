import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, User, X } from 'lucide-react';
import { AccountUser, logIn, signUp } from '../../data/authClient';

interface Props {
  open: boolean;
  /** No accounts yet: this signup creates the administrator. */
  isFirstRun: boolean;
  /** False when the modal was opened by the user rather than forced. */
  dismissible: boolean;
  onClose: () => void;
  onAuthenticated: (user: AccountUser) => void;
}

type Mode = 'login' | 'signup';

export const AuthModal: React.FC<Props> = ({ open, isFirstRun, dismissible, onClose, onAuthenticated }) => {
  const [mode, setMode] = useState<Mode>(isFirstRun ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMode(isFirstRun ? 'signup' : 'login');
      setError(null);
      // Focus moves into the dialog so a keyboard user is not left outside it.
      setTimeout(() => firstFieldRef.current?.focus(), 60);
    }
  }, [open, isFirstRun]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose();
      if (e.key !== 'Tab') return;
      // Keep Tab inside the dialog while it is modal.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = mode === 'signup' ? await signUp(email, password, name) : await logIn(email, password);
      onAuthenticated(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade"
      role="presentation"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl animate-rise overflow-hidden"
      >
        <div className="relative px-7 pt-7 pb-5 border-b border-slate-800">
          {dismissible && (
            <button
              onClick={onClose}
              aria-label="Tutup"
              className="absolute right-5 top-5 p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}

          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-blue-900/30">
            <ShieldCheck className="w-5 h-5 text-white" aria-hidden="true" />
          </div>

          <h2 id="auth-title" className="mt-4 text-lg font-extrabold text-white tracking-tight">
            {isFirstRun ? 'Buat akun administrator' : mode === 'signup' ? 'Buat akun' : 'Masuk'}
          </h2>
          <p className="mt-1.5 text-[12px] text-slate-400 leading-relaxed">
            {isFirstRun
              ? 'Akun pertama menjadi administrator, dan alamat emailnya yang dipakai untuk mengirim alert stock pick harian.'
              : mode === 'signup'
                ? 'Akun tambahan bisa memakai terminal, tetapi hanya administrator yang menerima alert dan memicu refresh.'
                : 'Masuk untuk memakai penyaring, chatbot, dan refresh data.'}
          </p>
        </div>

        <form onSubmit={submit} className="px-7 py-6 space-y-4">
          {mode === 'signup' && (
            <Field
              id="auth-name"
              label="Nama"
              icon={<User className="w-3.5 h-3.5" aria-hidden="true" />}
              inputRef={mode === 'signup' ? firstFieldRef : undefined}
              value={name}
              onChange={setName}
              placeholder="Nama Anda"
              autoComplete="name"
            />
          )}

          <Field
            id="auth-email"
            label="Email"
            icon={<Mail className="w-3.5 h-3.5" aria-hidden="true" />}
            inputRef={mode === 'login' ? firstFieldRef : undefined}
            value={email}
            onChange={setEmail}
            type="email"
            placeholder="nama@contoh.com"
            autoComplete="email"
            hint={isFirstRun ? 'Alert stock pick harian akan dikirim ke alamat ini.' : undefined}
          />

          <div>
            <label htmlFor="auth-password" className="text-[11px] font-semibold text-slate-300 block mb-1.5">
              Kata sandi
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true">
                <Lock className="w-3.5 h-3.5" />
              </span>
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={mode === 'signup' ? 'Minimal 10 karakter' : '••••••••••'}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-11 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-600 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" aria-hidden="true" /> : <Eye className="w-3.5 h-3.5" aria-hidden="true" />}
              </button>
            </div>
            {mode === 'signup' && (
              <p className="text-[10px] text-slate-600 mt-1.5">
                Disimpan sebagai hash scrypt dengan salt acak — kata sandinya sendiri tidak pernah ditulis ke disk.
              </p>
            )}
          </div>

          {error && (
            <div role="alert" className="flex gap-2 rounded-xl border border-rose-500/30 bg-rose-500/8 px-3.5 py-3">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" aria-hidden="true" />
              <p className="text-[11px] text-rose-300 leading-relaxed">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold shadow-lg shadow-blue-900/30 transition-all cursor-pointer"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {busy ? 'Memproses…' : isFirstRun ? 'Buat akun administrator' : mode === 'signup' ? 'Daftar' : 'Masuk'}
          </button>

          {!isFirstRun && (
            <p className="text-center text-[11px] text-slate-500">
              {mode === 'login' ? 'Belum punya akun?' : 'Sudah punya akun?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError(null);
                }}
                className="text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
              >
                {mode === 'login' ? 'Daftar' : 'Masuk'}
              </button>
            </p>
          )}
        </form>

        <div className="px-7 py-3.5 bg-slate-950/60 border-t border-slate-800">
          <p className="text-[10px] text-slate-600 leading-relaxed">
            Akun disimpan lokal di komputer Anda. Layanan ini berjalan lewat HTTP di localhost — aman di loopback,
            tetapi pasang TLS di depannya sebelum diekspos ke jaringan.
          </p>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{
  id: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
  inputRef?: React.RefObject<HTMLInputElement>;
}> = ({ id, label, icon, value, onChange, type = 'text', placeholder, autoComplete, hint, inputRef }) => (
  <div>
    <label htmlFor={id} className="text-[11px] font-semibold text-slate-300 block mb-1.5">
      {label}
    </label>
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600">{icon}</span>
      <input
        id={id}
        ref={inputRef}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-600 transition-colors"
      />
    </div>
    {hint && <p className="text-[10px] text-slate-600 mt-1.5">{hint}</p>}
  </div>
);
