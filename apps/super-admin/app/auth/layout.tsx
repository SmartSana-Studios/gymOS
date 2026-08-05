import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh w-full items-center justify-center overflow-hidden p-6 md:p-10">
      <Image
        src="/auth-background.webp"
        alt=""
        fill
        priority
        className="-z-20 object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-black/60" />
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <div className="relative h-10 w-48">
          <Image
            src="/gymos-logo-full-white.webp"
            alt="GymOS"
            fill
            className="object-contain"
          />
        </div>
        <div className="w-full">{children}</div>
      </div>
    </div>
  );
}
