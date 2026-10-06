import { cn } from "cn"
import { avatarFallbackText } from "@/lib/members/avatar-initials"

function Avatar({
  image,
  name,
  email,
  className,
}: {
  image: string | null
  name: string
  email: string
  className?: string
}) {
  return (
    <span
      data-slot="avatar"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-medium text-primary-foreground",
        className
      )}
    >
      {image ? (
        // data: URLs aren't compatible with next/image without a custom loader; a plain <img> is correct here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-full object-cover" />
      ) : (
        avatarFallbackText(name, email)
      )}
    </span>
  )
}

export { Avatar }
