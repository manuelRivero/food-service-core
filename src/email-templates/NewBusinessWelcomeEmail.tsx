import { Heading, Text } from "@react-email/components";
import { getGestyMascotImgSrcForEmail } from "./emailAssets";
import { GestyEmailLayout } from "./GestyEmailLayout";
import { EMAIL_THEME } from "./theme";

export type NewBusinessWelcomeEmailProps = {
  businessName: string;
  /** Fin del trial (ISO o texto legible) */
  trialEndsLabel: string;
  /** Límite mensual de tokens de IA del plan trial */
  tokenLimitLabel: string;
};

export function NewBusinessWelcomeEmail({
  businessName,
  trialEndsLabel,
  tokenLimitLabel,
}: NewBusinessWelcomeEmailProps) {
  const mascotImageUrl = getGestyMascotImgSrcForEmail();
  const preview = `${businessName}: tu espacio en gesty.ai ya está listo`;

  return (
    <GestyEmailLayout
      preview={preview}
      mascotImageUrl={mascotImageUrl}
      footerText="gesty.ai · Asistente conversacional para gastronomía"
    >
      <Heading
        as="h1"
        style={{
          color: "#1a1a1a",
          fontSize: "22px",
          fontWeight: 600,
          lineHeight: "28px",
          margin: "0 0 16px",
        }}
      >
        ¡Bienvenido/a a gesty.ai!
      </Heading>
      <Text
        style={{
          color: "#333333",
          fontSize: "16px",
          lineHeight: "24px",
          margin: "0 0 12px",
        }}
      >
        Creamos el negocio{" "}
        <strong style={{ color: EMAIL_THEME.primary }}>{businessName}</strong>{" "}
        en la plataforma. Ya podés empezar a configurar tu asistente y tu
        operación.
      </Text>
      <Text
        style={{
          color: "#333333",
          fontSize: "16px",
          lineHeight: "24px",
          margin: "0 0 8px",
        }}
      >
        <strong>Plan trial activo</strong>
      </Text>
      <Text
        style={{
          color: EMAIL_THEME.textMuted,
          fontSize: "15px",
          lineHeight: "22px",
          margin: "0 0 20px",
        }}
      >
        · Vence el {trialEndsLabel}
        <br />· Cupo mensual de tokens de IA: {tokenLimitLabel}
      </Text>
      <Text
        style={{
          color: "#333333",
          fontSize: "15px",
          lineHeight: "22px",
          margin: 0,
        }}
      >
        Próximos pasos sugeridos: conectar WhatsApp, revisar horarios y menú, y
        probar el bot con un pedido de prueba.
      </Text>
    </GestyEmailLayout>
  );
}
