"use client";

import { useRouter } from "next/navigation";
import { SignOut } from "@phosphor-icons/react";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="ghost-button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      <SignOut size={15} weight="bold" />
      Log out
    </button>
  );
}
