import { useCallback, useEffect, useState } from "react";
import "./App.css";

export type ApiUser = {
  id: string;
  email: string | null;
  wallet: string | null;
  displayName: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
};

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export default function App() {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/users`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `${res.status} ${res.statusText}`);
      }
      const data: unknown = await res.json();
      if (!Array.isArray(data)) throw new Error("Unexpected response shape");
      setUsers(data as ApiUser[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  return (
    <div className="app">
      <header className="header">
        <h1>Skill Hub</h1>
        <p className="subtitle">Users from the API</p>
        <button type="button" className="refresh" onClick={() => void loadUsers()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error ? (
        <div className="banner error" role="alert">
          <strong>Could not load users.</strong> {error}
          <p className="hint">
            Is the backend running? From <code>backend/</code> run <code>npm run dev</code>. API base:{" "}
            <code>{apiBase}</code>
          </p>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="users-table">
          <caption>{loading ? "Loading users…" : `${users.length} user(s)`}</caption>
          <thead>
            <tr>
              <th scope="col">Display name</th>
              <th scope="col">Email</th>
              <th scope="col">Wallet</th>
              <th scope="col">Role</th>
              <th scope="col">Id</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName ?? "—"}</td>
                <td>{u.email ?? "—"}</td>
                <td className="mono">{u.wallet ?? "—"}</td>
                <td>
                  <span className="pill">{u.role}</span>
                </td>
                <td className="mono muted">{u.id}</td>
              </tr>
            ))}
            {!loading && users.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  No users yet. Seed the DB from <code>backend/</code>: <code>npm run db:seed</code>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
