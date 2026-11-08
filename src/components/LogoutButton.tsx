"use client";

import { useRouter } from "next/navigation";
import { SignOut } from "@phosphor-icons/react";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="ghost-button"
      onClick={async () => {
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } catch {
          // Server unreachable — still navigate; /login will surface the error.
        }
        router.push("/login");
        router.refresh();
      }}
    >
      <SignOut size={15} weight="bold" />
      Log out
    </button>
  );
}
