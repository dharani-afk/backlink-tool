'use client';
import { useState } from 'react';
import Icon from '../icons';

export default function Login() {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) window.location.href = '/';
    else setError(d.error || 'Login failed');
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <span className="brand-mark"><Icon name="logo" size={22} /></span>
        <h1>Backlink Tool</h1>
        <p>Sign in with your team password to manage clients, sites and runs.</p>
        <label htmlFor="pw">Team password</label>
        <div className="pw">
          <input id="pw" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
          <button type="button" onClick={() => setShow(!show)} title={show ? 'Hide password' : 'Show password'}><Icon name={show ? 'eyeOff' : 'eye'} /></button>
        </div>
        {error && <div className="auth-error"><Icon name="alert" size={14} />{error}</div>}
        <button className="btn primary" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="auth-foot"><Icon name="lock" size={11} /> Private team dashboard</div>
      </form>
    </main>
  );
}
