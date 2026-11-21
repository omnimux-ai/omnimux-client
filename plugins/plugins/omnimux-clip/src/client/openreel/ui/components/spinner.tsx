import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { cn } from "../lib/utils"
import { useClipT } from "../../../i18n/index.js";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const t = useClipT();
  return (
    <Loader2Icon
      role="status"
      aria-label={t("Loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
