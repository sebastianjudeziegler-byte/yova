import Image from "next/image";
import yovaLogo from "@/app/icon.png";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup">
      <span className="brand-mark" aria-hidden="true">
        <Image src={yovaLogo} alt="" sizes="48px" />
      </span>
      {!compact && <span className="brand-word">YOVA</span>}
    </div>
  );
}
