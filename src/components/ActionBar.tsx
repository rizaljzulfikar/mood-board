"use client";

import { useEffect, useRef, useState } from "react";
import {
  CircleNotch,
  InstagramLogo,
  Link as LinkIcon,
  Note,
  PinterestLogo,
  SquaresFour,
  TiktokLogo,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { isInstagramPostUrl, isPinterestPinUrl, isTikTokPostUrl } from "@/lib/social-url";

const ICON = { size: 18, weight: "bold" as const };
const SMALL_ICON = { size: 15, weight: "bold" as const };

type SubmitMode = "link" | "instagram" | "tiktok" | "pinterest";

/** Dedicated import buttons, mirroring the Instagram one. */
const PLATFORMS = [
  {
    mode: "instagram",
    label: "Instagram",
    Icon: InstagramLogo,
    accepts: isInstagramPostUrl,
    invalid: "Enter an Instagram post or reel link",
  },
  {
    mode: "tiktok",
    label: "TikTok",
    Icon: TiktokLogo,
    accepts: isTikTokPostUrl,
    invalid: "Enter a TikTok video link",
  },
  {
    mode: "pinterest",
    label: "Pinterest",
    Icon: PinterestLogo,
    accepts: isPinterestPinUrl,
    invalid: "Enter a Pinterest pin link",
  },
] as const satisfies ReadonlyArray<{
  mode: Exclude<SubmitMode, "link">;
  label: string;
  Icon: typeof InstagramLogo;
  accepts: (url: URL) => boolean;
  invalid: string;
}>;

/** Parse an http(s) URL, or null when the input is not one. */
function toHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function ActionBar({
  uploading,
  importingLink,
  onUploadClick,
  onAddGroup,
  onAddLink,
  onAddNote,
}: {
  uploading: boolean;
  importingLink: boolean;
  onUploadClick: () => void;
  onAddGroup: () => void;
  /** Import a link or social post; resolves to an error message or null. */
  onAddLink: (url: string) => Promise<string | null>;
  onAddNote: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pending, setPending] = useState<SubmitMode | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const busy = importingLink || pending !== null;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function openDialog() {
    setLinkError(null);
    setOpen(true);
  }

  async function submit(mode: SubmitMode) {
    const raw = linkUrl.trim();
    if (!raw || busy) return;
    const url = toHttpUrl(raw);
    if (!url) {
      setLinkError("Enter a valid http(s) link");
      return;
    }
    const platform = PLATFORMS.find((p) => p.mode === mode);
    if (platform && !platform.accepts(url)) {
      setLinkError(platform.invalid);
      return;
    }
    setLinkError(null);
    setPending(mode);
    try {
      const error = await onAddLink(raw);
      if (error) {
        setLinkError(error);
        return;
      }
      setLinkUrl("");
      setOpen(false);
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <div
        className="action-bar"
        role="toolbar"
        aria-label="Add to board"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          className="action-bar-button"
          type="button"
          onClick={onAddGroup}
          title="Add a labeled group box"
          aria-label="Add group"
        >
          <SquaresFour {...ICON} />
        </button>
        <button
          className="action-bar-button"
          type="button"
          onClick={onAddNote}
          title="Add a sticky note"
          aria-label="Add note"
        >
          <Note {...ICON} />
        </button>
        <button
          className="action-bar-button"
          type="button"
          onClick={openDialog}
          title="Add a link or import from a social platform"
          aria-label="Add link"
        >
          <LinkIcon {...ICON} />
        </button>
        <button
          className="action-bar-button"
          type="button"
          onClick={onUploadClick}
          disabled={uploading}
          title="Upload images"
          aria-label="Upload images"
        >
          {uploading ? <CircleNotch {...ICON} className="spin" /> : <UploadSimple {...ICON} />}
        </button>
      </div>

      {open && (
        <div
          className="link-dialog-backdrop"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="link-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-dialog-title"
          >
            <div className="link-dialog-head">
              <h2 id="link-dialog-title">Add link</h2>
              <button
                className="action-bar-button link-dialog-close"
                type="button"
                onClick={() => setOpen(false)}
                title="Close"
                aria-label="Close"
              >
                <X size={16} weight="bold" />
              </button>
            </div>

            <form
              className="link-dialog-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit("link");
              }}
            >
              <label className="link-dialog-label" htmlFor="link-dialog-url">
                Link
              </label>
              <input
                id="link-dialog-url"
                ref={inputRef}
                type="text"
                placeholder="Paste an image, post, or page link…"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                disabled={busy}
              />
              {linkError && (
                <span className="link-dialog-error" role="alert">
                  <WarningCircle size={14} weight="fill" />
                  {linkError}
                </span>
              )}
              <div className="link-dialog-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busy || !linkUrl.trim()}
                >
                  {pending === "link" ? (
                    <CircleNotch {...SMALL_ICON} className="spin" />
                  ) : (
                    <LinkIcon {...SMALL_ICON} />
                  )}
                  Add link
                </button>
              </div>
              <div className="link-dialog-platforms">
                <span className="link-dialog-platforms-label">Import from</span>
                <div className="link-dialog-platform-buttons">
                  {PLATFORMS.map(({ mode, label, Icon }) => (
                    <button
                      key={mode}
                      className="ghost-button"
                      type="button"
                      onClick={() => void submit(mode)}
                      disabled={busy || !linkUrl.trim()}
                      title={`Import from ${label}`}
                      aria-label={`Import from ${label}`}
                    >
                      {pending === mode ? (
                        <CircleNotch {...SMALL_ICON} className="spin" />
                      ) : (
                        <Icon {...SMALL_ICON} />
                      )}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
