import { render, type Options as RenderOptions } from "@react-email/render";
import type { ReactElement } from "react";

export function renderEmailHtml(
  element: ReactElement,
  options?: RenderOptions
): Promise<string> {
  return render(element, options);
}
