/** Ruta pública del PNG (mismo archivo bajo `public/images/` en el repo). */
export const GESTY_MASCOT_PATH = "/images/gesty-face.png";

/**
 * Content-ID del adjunto inline que debe coincidir con `gestyMascotInlineAttachment()` en mail.service.
 * No uses localhost en correos: los clientes no pueden cargar 127.0.0.1 del remitente.
 */
export const GESTY_MASCOT_CONTENT_ID = "gesty-face@gesty.ai";

/**
 * `src` del `<Img>` en el HTML del correo.
 * Por defecto usa CID (imagen adjunta en el mismo mensaje). Opcional: `EMAIL_MASCOT_REMOTE_URL`
 * con una URL https pública al PNG si preferís no incrustar.
 */
export function getGestyMascotImgSrcForEmail(): string {
  const remote = process.env.EMAIL_MASCOT_REMOTE_URL?.trim();
  if (remote) return remote;
  return `cid:${GESTY_MASCOT_CONTENT_ID}`;
}

/**
 * URL absoluta al PNG si tenés `PUBLIC_URL` / `EMAIL_PUBLIC_URL` (p. ej. enlaces en web, no fiable en inbox).
 */
export function getGestyMascotPublicImageUrl(): string {
  const base = (process.env.EMAIL_PUBLIC_URL ?? process.env.PUBLIC_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  return base ? `${base}${GESTY_MASCOT_PATH}` : "";
}

/** @deprecated Usar getGestyMascotImgSrcForEmail() para plantillas enviadas por correo. */
export function getGestyMascotImageUrl(): string {
  return getGestyMascotImgSrcForEmail();
}
