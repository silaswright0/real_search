import Image from "next/image";

export function IronManButton() {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      className="ironman-btn h-9 w-9 shrink-0 overflow-hidden rounded-full border border-foreground"
    >
      <Image
        src="/ironman.png"
        alt=""
        width={36}
        height={36}
        className="ironman-img h-full w-full object-cover"
      />
    </button>
  );
}
