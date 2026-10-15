"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadLogo } from "./actions";

export function useLogoUpload(initialLogoUrl: string | null) {
  const { t } = useTranslation();
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (logoBlobUrlRef.current) URL.revokeObjectURL(logoBlobUrlRef.current);
    };
  }, []);

  async function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setLogoError(null);
    if (logoBlobUrlRef.current) {
      URL.revokeObjectURL(logoBlobUrlRef.current);
    }
    // The URL this upload should fall back to if it fails -- whatever was
    // showing before this attempt, not necessarily `initial.logoUrl` (a
    // prior successful upload in this same session may have already moved
    // it away from the initial value).
    const previousLogoUrl = logoUrl;
    // Client-side preview, before any server round-trip -- this is what
    // satisfies AC #1's "immediately" wording (story Dev Notes).
    const blobUrl = URL.createObjectURL(file);
    logoBlobUrlRef.current = blobUrl;
    setLogoUrl(blobUrl);
    setUploadingLogo(true);

    try {
      const formData = new FormData();
      formData.set("file", file);
      const { data, error } = await uploadLogo(formData);
      if (error) {
        setLogoError(error.message);
        URL.revokeObjectURL(blobUrl);
        logoBlobUrlRef.current = null;
        setLogoUrl(previousLogoUrl);
        return;
      }
      if (data) {
        URL.revokeObjectURL(blobUrl);
        logoBlobUrlRef.current = null;
        setLogoUrl(data.logoUrl);
      }
    } catch {
      setLogoError(t("common.somethingWentWrong"));
      URL.revokeObjectURL(blobUrl);
      logoBlobUrlRef.current = null;
      setLogoUrl(previousLogoUrl);
    } finally {
      setUploadingLogo(false);
    }
  }

  function handleRemoveLogo() {
    if (logoBlobUrlRef.current) {
      URL.revokeObjectURL(logoBlobUrlRef.current);
      logoBlobUrlRef.current = null;
    }
    setLogoUrl(null);
    setLogoError(null);
  }

  return { logoUrl, logoError, uploadingLogo, handleLogoSelect, handleRemoveLogo };
}

export type LogoUploadState = ReturnType<typeof useLogoUpload>;
