import Image from "next/image";
import { cn } from "@/lib/utils";

export interface AurcleanLogoProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  variant?: "full" | "icon" | "mark";
  showSubtitle?: boolean;
  subtitleText?: string;
  theme?: "dark" | "light" | "auto";
}

export function AurcleanLogo({
  className,
  size = "md",
  variant = "full",
  showSubtitle = false,
  subtitleText = "LAUNDRY MANAGEMENT ERP",
  theme = "auto",
}: AurcleanLogoProps) {
  const iconPx = {
    xs: 24,
    sm: 32,
    md: 38,
    lg: 46,
    xl: 60,
    "2xl": 76,
  }[size];

  const titleTextSize = {
    xs: "text-xs",
    sm: "text-sm font-extrabold",
    md: "text-base font-extrabold",
    lg: "text-lg font-black",
    xl: "text-2xl font-black",
    "2xl": "text-3xl font-black",
  }[size];

  const subtitleTextSize = {
    xs: "text-[8px]",
    sm: "text-[8.5px]",
    md: "text-[9.5px]",
    lg: "text-[10px]",
    xl: "text-[11px]",
    "2xl": "text-[12px]",
  }[size];

  const titleColor =
    theme === "dark"
      ? "text-white"
      : theme === "light"
      ? "text-slate-900"
      : "text-slate-900 dark:text-white";

  const subtitleColor =
    theme === "dark"
      ? "text-emerald-400/90"
      : theme === "light"
      ? "text-emerald-700"
      : "text-emerald-600 dark:text-emerald-400";

  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none group", className)}>
      <div className="relative flex items-center justify-center shrink-0">
        <Image
          src="/logo.png"
          alt="AURCLEAN Logo"
          width={iconPx}
          height={iconPx}
          priority
          className="object-contain transition-transform duration-300 group-hover:scale-105 filter drop-shadow-[0_2px_10px_rgba(16,185,129,0.3)]"
          style={{ width: `${iconPx}px`, height: `${iconPx}px` }}
        />
      </div>
      {variant === "full" && (
        <div className="flex flex-col justify-center leading-none">
          <span className={cn("tracking-tight font-sans flex items-center gap-0.5", titleTextSize, titleColor)}>
            <span>AUR</span>
            <span className="text-emerald-500">CLEAN</span>
          </span>
          {showSubtitle && (
            <span
              className={cn(
                "font-bold tracking-[0.16em] uppercase leading-none mt-1",
                subtitleTextSize,
                subtitleColor,
              )}
            >
              {subtitleText}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

