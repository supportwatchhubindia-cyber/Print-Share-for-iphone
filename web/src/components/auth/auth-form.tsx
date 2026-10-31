"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field, Input } from "../ui/input";
import { ErrorState } from "../shared/states";
import { ApiClientError, apiFetch } from "@/lib/api-client";

export function AuthForm({ mode, next }: { mode: "login" | "register"; next: string }) {
  const [values, setValues] = React.useState({ name: "", email: "", password: "" });
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const isRegister = mode === "register";

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setFields((f) => ({ ...f, [key]: "" }));
    setError(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFields({});
    try {
      await apiFetch(isRegister ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        json: isRegister ? values : { email: values.email, password: values.password },
      });
      // Full navigation so the server layout picks up the new session cookie.
      window.location.assign(next);
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setFields(err.fields);
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{isRegister ? "Create your account" : "Welcome back"}</h1>
      <p className="mt-1 text-sm text-muted">
        {isRegister ? "Start printing from your phone in a few minutes." : "Sign in to print from this device."}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {error && !Object.values(fields).some(Boolean) && <ErrorState message={error} />}
        {isRegister && (
          <Field label="Name" htmlFor="name" error={fields.name}>
            <Input id="name" autoComplete="name" value={values.name} onChange={set("name")} invalid={!!fields.name} required />
          </Field>
        )}
        <Field label="Email" htmlFor="email" error={fields.email}>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={values.email}
            onChange={set("email")}
            invalid={!!fields.email}
            required
          />
        </Field>
        <Field label="Password" htmlFor="password" error={fields.password} hint={isRegister ? "At least 10 characters." : undefined}>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isRegister ? "new-password" : "current-password"}
              value={values.password}
              onChange={set("password")}
              invalid={!!fields.password}
              className="pr-11"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-ink"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {isRegister ? "Create account" : "Sign in"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {isRegister ? "Already have an account? " : "New to PrintShare? "}
        <Link href={`${isRegister ? "/login" : "/register"}?next=${encodeURIComponent(next)}`} className="font-medium text-accent hover:underline">
          {isRegister ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </Card>
  );
}
