import type { PageTemplateId } from "@/lib/pageTemplates";

/**
 * A small wireframe of each template for the picker. Drawn, not rendered from the gym's content (the spec's "thumbnail from real content" is a
 * later step); the colours are the templates' own, not the gym's. Decorative: the card's text names and describes the template.
 */
export function TemplateThumb({ id }: { id: PageTemplateId }) {
  if (id === "volt") {
    return (
      <svg viewBox="0 0 160 100" className="h-auto w-full rounded border border-neutral-800" aria-hidden="true" focusable="false">
        <rect width="160" height="100" fill="#07080D" />
        <rect width="160" height="7" fill="#F2E600" />
        <rect y="7" width="160" height="40" fill="#10131B" />
        <rect x="10" y="20" width="12" height="12" fill="none" stroke="#F2E600" strokeWidth="1.2" />
        <rect x="10" y="35" width="64" height="5" fill="#FFFFFF" />
        <rect x="10" y="42" width="28" height="7" fill="#F2E600" />
        <rect x="42" y="42" width="28" height="7" fill="none" stroke="#FFFFFF" strokeWidth="1" />
        <rect x="10" y="55" width="3" height="9" fill="#F2E600" />
        <rect x="16" y="57" width="34" height="5" fill="#FFFFFF" />
        <rect x="10" y="68" width="62" height="3" fill="#6B7280" />
        <rect x="10" y="74" width="54" height="3" fill="#6B7280" />
        <rect x="86" y="56" width="29" height="18" fill="#10131B" stroke="#2A3142" />
        <rect x="119" y="56" width="29" height="18" fill="#10131B" stroke="#2A3142" />
        <rect x="90" y="60" width="9" height="4" fill="#F2E600" />
        <rect x="123" y="60" width="9" height="4" fill="#F2E600" />
        <rect x="10" y="84" width="40" height="10" fill="#10131B" stroke="#2A3142" />
        <rect x="54" y="84" width="40" height="10" fill="#10131B" stroke="#2A3142" />
        <rect x="98" y="84" width="40" height="10" fill="#10131B" stroke="#2A3142" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 160 100" className="h-auto w-full rounded border border-neutral-300" aria-hidden="true" focusable="false">
      <rect width="160" height="100" fill="#F5F5F1" />
      <rect width="160" height="44" fill="#121B2B" />
      <rect x="10" y="9" width="10" height="10" rx="5" fill="#FFFFFF" stroke="#E0971F" strokeWidth="1.5" />
      <rect x="10" y="26" width="8" height="2.5" fill="#E0971F" />
      <rect x="10" y="30" width="70" height="6" fill="#FFFFFF" />
      <rect x="10" y="38" width="26" height="4" rx="1" fill="#E0971F" />
      <rect x="40" y="38" width="26" height="4" rx="1" fill="none" stroke="#FFFFFF" strokeWidth="0.8" />
      <rect x="10" y="52" width="9" height="2.5" fill="#E0971F" />
      <rect x="10" y="57" width="34" height="5" fill="#1B2A41" />
      <rect x="10" y="66" width="62" height="3" fill="#9CA3AF" />
      <rect x="10" y="72" width="54" height="3" fill="#9CA3AF" />
      <rect x="86" y="50" width="64" height="30" fill="#1B2A41" />
      <rect x="92" y="56" width="5" height="5" rx="2.5" fill="#E0971F" />
      <rect x="100" y="57" width="36" height="3" fill="#FFFFFF" />
      <rect x="92" y="66" width="5" height="5" rx="2.5" fill="#E0971F" />
      <rect x="100" y="67" width="30" height="3" fill="#FFFFFF" />
      <rect y="86" width="160" height="14" fill="#121B2B" />
    </svg>
  );
}
