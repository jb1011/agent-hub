"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getAddress } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { SkillHubClient } from "skillhub-sdk";
import { clientApiBaseUrl } from "../lib/backend-url";
import {
  authChainId,
  buildSiweMessage,
  completeWalletLogin,
  fetchMe,
  isTokenFresh,
  logoutSession,
  readStoredAuth,
  refreshAccessToken,
  requestAuthChallenge,
  tokenResponseToStored,
  writeStoredAuth,
  type MeResponse,
  type StoredAuth,
} from "../lib/user-auth";

type AuthContextValue = {
  user: MeResponse | null;
  isAuthenticated: boolean;
  isSigningIn: boolean;
  authError: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string>;
  skillHub: SkillHubClient;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeAddress(address: string): string {
  return getAddress(address);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [storedAuth, setStoredAuth] = useState<StoredAuth | null>(null);
  const [user, setUser] = useState<MeResponse | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const storedAuthRef = useRef<StoredAuth | null>(null);
  const refreshPromiseRef = useRef<Promise<string> | null>(null);
  const userRef = useRef<MeResponse | null>(null);

  useEffect(() => {
    setStoredAuth(readStoredAuth());
    setHydrated(true);
  }, []);

  useEffect(() => {
    storedAuthRef.current = storedAuth;
  }, [storedAuth]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const applyAuth = useCallback((auth: StoredAuth | null, nextUser: MeResponse | null) => {
    storedAuthRef.current = auth;
    setStoredAuth(auth);
    setUser(nextUser);
    writeStoredAuth(auth);
  }, []);

  const signOut = useCallback(async () => {
    refreshPromiseRef.current = null;
    try {
      await logoutSession();
    } catch {
      // Clear local session even if the backend logout fails.
    }
    applyAuth(null, null);
    setAuthError(null);
  }, [applyAuth]);

  const refreshToken = useCallback(async (): Promise<string> => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const promise = (async () => {
      const current = storedAuthRef.current;
      if (!current) {
        throw new Error("not_authenticated");
      }

      const token = await refreshAccessToken();
      const auth = tokenResponseToStored(token, current.walletAddress);
      applyAuth(auth, userRef.current);
      return auth.accessToken;
    })();

    refreshPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      refreshPromiseRef.current = null;
    }
  }, [applyAuth]);

  const getAccessToken = useCallback(async (): Promise<string> => {
    const current = storedAuthRef.current;
    if (!current) {
      throw new Error("not_authenticated");
    }

    if (isTokenFresh(current.expiresAt)) {
      return current.accessToken;
    }

    return refreshToken();
  }, [refreshToken]);

  const skillHub = useMemo(
    () =>
      new SkillHubClient({
        baseUrl: clientApiBaseUrl(),
        userAuth: { accessToken: getAccessToken },
      }),
    [getAccessToken],
  );

  const signIn = useCallback(async () => {
    if (!address) {
      throw new Error("Connect a wallet before signing in.");
    }

    setAuthError(null);
    setIsSigningIn(true);

    try {
      const walletAddress = normalizeAddress(address);
      const challenge = await requestAuthChallenge(walletAddress, authChainId());
      const message = buildSiweMessage(challenge);
      const signature = await signMessageAsync({ message });
      const token = await completeWalletLogin({
        challenge_id: challenge.challenge_id,
        message,
        signature,
      });

      const auth = tokenResponseToStored(token, walletAddress);
      const me = await fetchMe(auth.accessToken);
      applyAuth(auth, me);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to sign in with wallet";
      setAuthError(message);
      throw err;
    } finally {
      setIsSigningIn(false);
    }
  }, [address, applyAuth, signMessageAsync]);

  useEffect(() => {
    if (!hydrated || !isConnected || !address || !storedAuth) return;

    const connected = normalizeAddress(address);
    const signedIn = normalizeAddress(storedAuth.walletAddress);
    if (connected !== signedIn) {
      void signOut();
    }
  }, [address, hydrated, isConnected, signOut, storedAuth]);

  useEffect(() => {
    if (!hydrated || !storedAuth) return;

    let cancelled = false;
    void (async () => {
      try {
        const token = isTokenFresh(storedAuth.expiresAt)
          ? storedAuth.accessToken
          : await refreshToken();
        const me = await fetchMe(token);
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) void signOut();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated, refreshToken, signOut, storedAuth]);

  const walletMatchesSession = Boolean(
    storedAuth &&
      address &&
      normalizeAddress(storedAuth.walletAddress) === normalizeAddress(address),
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: walletMatchesSession,
      isSigningIn,
      authError,
      signIn,
      signOut,
      getAccessToken,
      skillHub,
    }),
    [
      authError,
      getAccessToken,
      isSigningIn,
      signIn,
      signOut,
      skillHub,
      user,
      walletMatchesSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
